import { expectGoogleResponse, GoogleApiError } from "./api-error";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const LIST_PAGE_SIZE = 50;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

export interface CreatedGoogleDoc {
  id: string;
  name: string;
  url: string;
}

export interface DriveClient {
  listFiles(query?: string): Promise<DriveFile[]>;
  readFile(file: DriveFile): Promise<string>;
  findCreatedDocument(actionId: string): Promise<CreatedGoogleDoc | null>;
  createGoogleDoc(input: { actionId: string; title: string; body: string }): Promise<CreatedGoogleDoc>;
}

interface RawDriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

function createdDoc(file: RawDriveFile): CreatedGoogleDoc {
  if (!file.id) throw new Error("Drive created a document without returning an id.");
  return {
    id: file.id,
    name: file.name ?? "Untitled document",
    url: file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`,
  };
}

function privatePropertyQuery(actionId: string): string {
  const safe = actionId.replace(/[^a-zA-Z0-9-]/g, "");
  return `appProperties has { key = 'conductflowActionId' and value = '${safe}' } and trashed = false`;
}

export function createDriveClient(accessToken: string): DriveClient {
  const headers = { Authorization: `Bearer ${accessToken}` };

  async function listFiles(query?: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      pageSize: String(LIST_PAGE_SIZE),
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime)",
    });
    if (query) params.set("q", query);
    const response = await fetch(`${DRIVE_FILES}?${params}`, { headers });
    await expectGoogleResponse(response, "drive", "files.list");
    const json = await response.json() as { files?: RawDriveFile[] };
    return (json.files ?? []).map((file) => ({
      id: file.id ?? "",
      name: file.name ?? "Untitled",
      mimeType: file.mimeType ?? "application/octet-stream",
      modifiedTime: file.modifiedTime ?? "",
    }));
  }

  async function readFile(file: DriveFile): Promise<string> {
    const url = file.mimeType === GOOGLE_DOC_MIME
      ? `${DRIVE_FILES}/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent("text/plain")}`
      : `${DRIVE_FILES}/${encodeURIComponent(file.id)}?alt=media`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new GoogleApiError("drive", `read ${file.name}`, response.status, body);
    }
    return response.text();
  }

  async function findCreatedDocument(actionId: string): Promise<CreatedGoogleDoc | null> {
    const params = new URLSearchParams({
      q: privatePropertyQuery(actionId),
      pageSize: "1",
      fields: "files(id,name,mimeType,webViewLink)",
    });
    const response = await fetch(`${DRIVE_FILES}?${params}`, { headers });
    await expectGoogleResponse(response, "drive", "files.list idempotency lookup");
    const json = await response.json() as { files?: RawDriveFile[] };
    const match = json.files?.find((file) => file.mimeType === GOOGLE_DOC_MIME);
    return match ? createdDoc(match) : null;
  }

  async function createGoogleDoc(input: {
    actionId: string;
    title: string;
    body: string;
  }): Promise<CreatedGoogleDoc> {
    const existing = await findCreatedDocument(input.actionId);
    if (existing) return existing;

    const boundary = `conductflow_${input.actionId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const metadata = {
      name: input.title,
      mimeType: GOOGLE_DOC_MIME,
      appProperties: { conductflowActionId: input.actionId },
    };
    const multipart = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.body,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const params = new URLSearchParams({
      uploadType: "multipart",
      fields: "id,name,mimeType,webViewLink",
    });
    const response = await fetch(`${DRIVE_UPLOAD}?${params}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    await expectGoogleResponse(response, "drive", "files.create Google Doc");
    return createdDoc(await response.json() as RawDriveFile);
  }

  return { listFiles, readFile, findCreatedDocument, createGoogleDoc };
}

export { GOOGLE_DOC_MIME, GoogleApiError };

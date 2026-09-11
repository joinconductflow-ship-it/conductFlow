import type { LanguageModel } from "ai";
import {
  EXTRACTION_MODEL,
  MAX_PREVIOUS_SUGGESTIONS,
  MAX_TRANSCRIPT_EXCERPT_CHARS,
  meetingAssistantSchema,
} from "@/lib/agent/schema";
import {
  MEETING_ASSISTANT_SYSTEM_PROMPT,
  buildMeetingAssistantPrompt,
} from "@/lib/agent/prompts";
import { sanitizeIngested } from "@/lib/agent/injection";
import { generateObjectWithRetry } from "@/lib/agent/generate";

export interface GenerateSuggestionsArgs {
  recentTranscript: string;
  previousSuggestions?: string[];
}

export interface GenerateSuggestionsResult {
  suggestions: string[];
  flagged: string[];
}

export async function generateMeetingSuggestions(
  args: GenerateSuggestionsArgs, model?: LanguageModel,
): Promise<GenerateSuggestionsResult> {
  if (!args.recentTranscript.trim()) throw new Error("No transcript text provided.");
  if (args.recentTranscript.length > MAX_TRANSCRIPT_EXCERPT_CHARS) {
    throw new Error(
      `Transcript excerpt is too long: ${args.recentTranscript.length} characters `
      + `(max ${MAX_TRANSCRIPT_EXCERPT_CHARS}).`,
    );
  }

  const previousSuggestions = (args.previousSuggestions ?? []).slice(-MAX_PREVIOUS_SUGGESTIONS);
  const { flagged } = sanitizeIngested(args.recentTranscript);
  const result = await generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: MEETING_ASSISTANT_SYSTEM_PROMPT,
    prompt: buildMeetingAssistantPrompt({
      recentTranscript: args.recentTranscript,
      previousSuggestions,
    }),
    schema: meetingAssistantSchema,
  });

  return { suggestions: result.suggestions, flagged };
}

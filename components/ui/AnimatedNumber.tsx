"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";

/**
 * Counts up to `value` once, when the tile first scrolls into view. Framer's spring
 * (not a linear tween) is what makes it read as physical rather than a progress bar —
 * it overshoots slightly and settles, the way a real needle would.
 */
export function AnimatedNumber({ value, prefix = "", suffix = "" }: {
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, value, motionValue]);

  useEffect(() => spring.on("change", (latest) => {
    if (ref.current) ref.current.textContent = `${prefix}${Math.round(latest)}${suffix}`;
  }), [spring, prefix, suffix]);

  return <span ref={ref}>{prefix}0{suffix}</span>;
}

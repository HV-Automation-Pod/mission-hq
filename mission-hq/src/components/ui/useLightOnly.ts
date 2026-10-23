"use client";

import { useEffect } from "react";

/**
 * The Petrol & Oat design is light only. Take `dark` off <html> while a view is
 * mounted, and give it back when it unmounts. Scroll is smooth only while one
 * of these views is up.
 */
export function useLightOnly() {
  useEffect(() => {
    const root = document.documentElement;
    const was = root.classList.contains("dark");
    root.classList.remove("dark");
    const behaviour = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => { if (was) root.classList.add("dark"); root.style.scrollBehavior = behaviour; };
  }, []);
}

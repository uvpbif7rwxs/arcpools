"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "arcpools-theme";

/**
 * Dark/light switch.
 *
 * The attribute is set by a blocking inline script in `layout.tsx` before first
 * paint, so there is no flash of the wrong theme. That makes the DOM the source
 * of truth rather than React state, which is why this subscribes to the
 * attribute with `useSyncExternalStore` instead of copying it into `useState`
 * inside an effect — the latter causes a second render on every mount and is
 * flagged by the hooks lint rules.
 *
 * `getServerSnapshot` returns the same default the server renders, so hydration
 * stays consistent; the observer then reports the real value immediately.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerSnapshot(): "dark" | "light" {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = getSnapshot() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode, strict settings). The attribute
      // has still changed, so the page re-themes for this session.
    }
  }, []);

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button type="button" onClick={toggle} className="btn btn-ghost" aria-label={label} title={label}>
      <span aria-hidden>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

/** Applies the stored theme before first paint. Dark is the default. */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});document.documentElement.dataset.theme=t==='light'?'light':'dark';}catch(e){}})();`;

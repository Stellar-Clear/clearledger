"use client";

import { useEffect, useRef } from "react";

export interface FocusTrapOptions {
  /**
   * Mark the content around the trap as `inert` (and `aria-hidden`) while it
   * is active. Use this for modal dialogs so pointer and assistive-technology
   * users cannot reach the page behind the dialog. Defaults to `false` to keep
   * popover/dropdown behaviour (e.g. click-outside-to-close) unchanged.
   */
  inertBackground?: boolean;
}

/**
 * Custom hook that traps keyboard focus within a container element.
 *
 * When `enabled` is `true`, the hook:
 * 1. Saves the currently focused element and moves focus into the container
 *    (first focusable child, or the container itself if none exist).
 * 2. Intercepts Tab and Shift+Tab key presses so focus cycles within the
 *    container rather than escaping to elements outside it.
 * 3. Pulls focus back into the container if it moves outside (for example via
 *    a programmatic `.focus()` call or a pointer interaction).
 * 4. Intercepts the Escape key, stops its propagation, and invokes the
 *    optional `onEscape` callback.
 * 5. Optionally marks the surrounding page `inert`/`aria-hidden` while the
 *    trap is active.
 * 6. On cleanup (or when `enabled` becomes `false`), restores focus to the
 *    element that was focused before the trap activated. Removed triggers are
 *    ignored instead of throwing.
 *
 * Attach the returned ref to the container element whose focus should be
 * trapped (e.g. a modal dialog, dropdown, or popover).
 *
 * Only the most recently enabled trap handles keyboard events, so dialogs
 * opened on top of another dialog (for example transaction authorization
 * guidance on top of a registration form) behave as expected.
 *
 * @param enabled - Whether the focus trap is active. Pass `false` to disable
 *   the trap without removing the ref from the DOM.
 * @param onEscape - Optional callback invoked when the Escape key is pressed
 *   while the trap is active. Useful for closing modals or dismissing menus.
 * @param options - Optional behaviour flags, see {@link FocusTrapOptions}.
 *
 * @returns A React ref object to attach to the focus-trap container element.
 *
 * @example
 * const modalRef = useFocusTrap(isOpen, () => setIsOpen(false), {
 *   inertBackground: true,
 * });
 *
 * return (
 *   <dialog ref={modalRef} open={isOpen}>
 *     <button>First</button>
 *     <button>Last</button>
 *   </dialog>
 * );
 */
export function useFocusTrap<T extends HTMLElement>(
  enabled: boolean,
  onEscape?: () => void,
  options: FocusTrapOptions = {},
) {
  const ref = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const inertBackground = options.inertBackground === true;

  useEffect(() => {
    if (!enabled) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const container = ref.current;
    if (!container) return;

    activeTraps.push(container);
    const releaseBackground = inertBackground
      ? makeBackgroundInert(container)
      : () => {};

    const focusInitial = () => {
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    };

    focusInitial();

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopMost(container)) return;
      const target = event.target as Node | null;
      if (target === container || (target && container.contains(target))) {
        return;
      }
      focusInitial();
    };

    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      releaseBackground();

      const wasTopMost = isTopMost(container);
      removeTrap(container);

      if (wasTopMost) {
        const nextTopMost = activeTraps[activeTraps.length - 1];
        // If another dialog is still open, only restore focus when the
        // trigger lives inside it; otherwise focus would escape that dialog.
        if (
          !nextTopMost ||
          (previousFocus && nextTopMost.contains(previousFocus))
        ) {
          restoreFocus(previousFocus);
        }
      }
    };
  }, [enabled, inertBackground]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const container = ref.current;
      if (!container || !isTopMost(container)) return;

      if (e.key === "Escape") {
        e.stopPropagation();
        onEscapeRef.current?.();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Focus somehow ended up outside the trap (e.g. the browser moved it
      // after a background click). Pull it back on the next Tab instead of
      // letting it walk through the page.
      if (!active || !container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);

  return ref;
}

const activeTraps: HTMLElement[] = [];

function isTopMost(container: HTMLElement): boolean {
  return activeTraps[activeTraps.length - 1] === container;
}

function removeTrap(container: HTMLElement): void {
  const index = activeTraps.lastIndexOf(container);
  if (index !== -1) activeTraps.splice(index, 1);
}

function restoreFocus(element: HTMLElement | null): void {
  // The trigger may have been unmounted while the dialog was open (for
  // example a form that closes itself after submitting). Focusing a detached
  // node is a no-op, but never leave focus stranded on a removed dialog.
  if (!element || !element.isConnected) return;

  element.focus();

  if (document.activeElement !== element) {
    requestAnimationFrame(() => {
      if (element.isConnected) element.focus();
    });
  }
}

interface InertEntry {
  count: number;
  hadInert: boolean;
  previousAriaHidden: string | null;
}

const inertEntries = new Map<HTMLElement, InertEntry>();

/**
 * Marks every sibling of the container and of its ancestors (up to `<body>`)
 * as inert so background content cannot be focused or clicked. Reference
 * counts keep nested dialogs safe when they share background elements.
 */
function makeBackgroundInert(container: HTMLElement): () => void {
  const elements = new Set<HTMLElement>();
  let node: HTMLElement | null = container;

  while (node && node !== document.body && node.parentElement) {
    const parent = node.parentElement;
    for (const child of Array.from(parent.children)) {
      if (child !== node && child instanceof HTMLElement) {
        elements.add(child);
      }
    }
    node = parent;
  }

  const applied = Array.from(elements);
  for (const element of applied) {
    const existing = inertEntries.get(element);
    if (existing) {
      existing.count += 1;
      continue;
    }

    inertEntries.set(element, {
      count: 1,
      hadInert: element.hasAttribute("inert"),
      previousAriaHidden: element.getAttribute("aria-hidden"),
    });
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  }

  return () => {
    for (const element of applied) {
      const entry = inertEntries.get(element);
      if (!entry) continue;

      entry.count -= 1;
      if (entry.count > 0) continue;

      inertEntries.delete(element);
      if (!entry.hadInert) element.removeAttribute("inert");
      if (entry.previousAriaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", entry.previousAriaHidden);
      }
    }
  };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selectors = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ];

  return Array.from(
    container.querySelectorAll<HTMLElement>(selectors.join(",")),
  ).filter((el) => {
    if (el.closest("[hidden], [inert]")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest('[aria-hidden="true"]')) return false;

    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

/**
 * A category, shown as its emoji plus its name.
 *
 * The glyph is what makes a dense ledger scannable — the eye finds 🏠 in a
 * column faster than it reads "Rent". It is decorative, so it carries
 * aria-hidden and the name is always present as text; nothing depends on
 * recognising the picture.
 */
import { useRef, useState } from "react";
import { PopoverPanel, PopoverClose } from "./primitives";

/** Neutral stand-in so rows without an emoji still line up. */
const FALLBACK = "•";

/**
 * The first user-perceived character, not the first code unit.
 *
 * Modern emoji are sequences: 🏳️‍🌈 is six UTF-16 units joined by zero-width
 * joiners, and cutting one short leaves a dangling joiner that renders as
 * mojibake. Intl.Segmenter knows where the boundaries are; where it is
 * unavailable the whole trimmed string is kept, because a glyph that is too
 * long is still a glyph, while a severed one is garbage.
 */
export function firstGrapheme(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  if (typeof Intl.Segmenter !== "function") return trimmed;
  const [first] = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  return first?.segment ?? trimmed;
}

export function CategoryChip({
  name,
  emoji,
  muted = false,
}: {
  name: string;
  emoji?: string | null;
  muted?: boolean;
}) {
  return (
    <span className={`category-chip${muted ? " category-chip--muted" : ""}`}>
      <span className="category-chip__emoji" aria-hidden="true">
        {emoji || FALLBACK}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * A small curated palette rather than a full emoji keyboard.
 *
 * These are the glyphs a set of books actually needs; an exhaustive picker
 * would be a large dependency and a worse experience for the task. Anything
 * else can still be typed or pasted into the field.
 */
/** Must match the grid's CSS column count; arrow-key movement depends on it. */
const COLUMNS = 8;

export const CATEGORY_EMOJIS = [
  "💰",
  "🎁",
  "🤝",
  "📥",
  "📤",
  "🏠",
  "👷",
  "🎉",
  "✈️",
  "💻",
  "📣",
  "🔄",
  "📁",
  "❓",
  "🧾",
  "🏦",
  "⚡️",
  "🌐",
  "📱",
  "🚗",
  "🍽️",
  "☕️",
  "📚",
  "🛠️",
  "🎨",
  "⚖️",
  "🏥",
  "🔐",
  "📦",
  "🌱",
  "🎓",
  "🧑‍💻",
] as const;

export function EmojiPicker({
  value,
  onChange,
  label = "Emoji",
  variant = "bare",
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  label?: string;
  /** "field" beside form inputs; "bare" inside a list, where chrome is noise. */
  variant?: "bare" | "field";
}) {
  const [custom, setCustom] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Arrow-key movement across the palette.
   *
   * Without it the only way past the grid is thirty-two presses of Tab, which
   * puts the custom field and Clear button out of practical reach for anyone
   * navigating by keyboard. Roving tabindex keeps the grid a single tab stop
   * and lets the arrows do the work, as a grid of choices should.
   */
  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    const STEP: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const items = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>(".emoji-grid__item") ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1 || items.length === 0) return;

    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key in STEP) next = current + STEP[event.key]!;
    else return;

    if (next < 0 || next >= items.length) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <PopoverPanel
      align="start"
      width={268}
      trigger={
        <button
          type="button"
          className={variant === "field" ? "emoji-trigger emoji-trigger--field" : "emoji-trigger"}
          aria-label={value ? `${label}, currently ${value}. Change it` : `Choose ${label}`}
        >
          <span aria-hidden="true">{value || FALLBACK}</span>
        </button>
      }
    >
      <div className="panel__body stack stack--sm">
        <div
          className="emoji-grid"
          ref={gridRef}
          role="group"
          aria-label={`${label} choices`}
          onKeyDown={moveFocus}
        >
          {CATEGORY_EMOJIS.map((emoji, index) => (
            <PopoverClose asChild key={emoji}>
              <button
                type="button"
                className="emoji-grid__item"
                aria-label={emoji}
                aria-pressed={value === emoji}
                tabIndex={(value ? value === emoji : index === 0) ? 0 : -1}
                onClick={() => onChange(emoji)}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            </PopoverClose>
          ))}
        </div>

        <div className="row row--xs">
          <input
            className="input grow"
            value={custom}
            placeholder="Or paste any emoji"
            aria-label="Custom emoji"
            onChange={(event) => setCustom(event.target.value)}
          />
          <PopoverClose asChild>
            <button
              type="button"
              className="button button--sm"
              disabled={firstGrapheme(custom) === ""}
              onClick={() => onChange(firstGrapheme(custom))}
            >
              Use
            </button>
          </PopoverClose>
        </div>

        <PopoverClose asChild>
          <button
            type="button"
            className="button button--subtle button--sm"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        </PopoverClose>
      </div>
    </PopoverPanel>
  );
}

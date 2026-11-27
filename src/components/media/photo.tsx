import Image from "next/image";

type PhotoProps = {
  src: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
  credit?: string | null;
  creditPosition?: "inside" | "inside-top" | "none";
  /** Fill the nearest positioned ancestor instead of sizing from className (e.g. aspect-ratio). */
  fill?: boolean;
};

/**
 * Photography in a fixed-ratio frame (the parent sets the aspect ratio or size), so loading never shifts
 * layout. Falls back to a typographic panel when an event has no image.
 */
export function Photo({
  src,
  alt,
  sizes,
  priority,
  className = "",
  imageClassName = "",
  credit,
  creditPosition = "inside",
  fill = false,
}: PhotoProps) {
  return (
    <div className={`${fill ? "absolute inset-0" : "relative"} overflow-hidden bg-graphite-900 ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={`object-cover ${imageClassName}`}
        />
      ) : (
        // Decorative, non-text fallback (a text glyph here would be low-contrast text to assistive checks).
        <div aria-hidden className="absolute inset-0 grid place-items-center">
          <span className="size-3 rounded-full bg-lime/70" />
        </div>
      )}
      {credit && creditPosition !== "none" && (
        <span className={`absolute right-2 ${creditPosition === "inside-top" ? "top-2" : "bottom-2"} max-w-[calc(100%-1rem)] truncate label bg-obsidian/60 px-1.5 py-0.5 text-[0.625rem] text-graphite-300 backdrop-blur-sm`}>
          {credit}
        </span>
      )}
    </div>
  );
}

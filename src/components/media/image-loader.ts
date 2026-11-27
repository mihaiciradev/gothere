"use client";

type LoaderInput = { src: string; width: number; quality?: number };

/**
 * next/image loader. Unsplash images are resized and re-encoded (AVIF/WebP) by Unsplash's imgix CDN,
 * so the browser only downloads the width it renders. Local assets are served as-is.
 */
export default function imageLoader({ src, width, quality }: LoaderInput): string {
  if (src.startsWith("https://images.unsplash.com/")) {
    const url = new URL(src);
    url.searchParams.set("w", String(width));
    url.searchParams.set("q", String(quality ?? 70));
    url.searchParams.set("auto", "format");
    url.searchParams.set("fit", "crop");
    return url.toString();
  }
  return src;
}

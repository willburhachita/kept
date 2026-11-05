import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

/**
 * A full-bleed photo for an absolutely positioned slot (the parent must be `relative`).
 * Served from our own CDN at the size the screen needs (AVIF/WebP), with a blurred
 * preview while it loads. Pass `preload` only for photos visible on first paint.
 */
export function Photo({ src, alt = "", sizes, preload, className }: { src: StaticImageData; alt?: string; sizes: string; preload?: boolean; className?: string }) {
  return <Image src={src} alt={alt} fill sizes={sizes} preload={preload} fetchPriority={preload ? "high" : undefined} placeholder="blur" className={cn("object-cover", className)} />;
}

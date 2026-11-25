import Image from "next/image";

/**
 * The MissionHQ mark (white pin, H and calendar check on black), the ONE logo
 * used everywhere it appears: the dashboard and member headers and the login
 * page. Added 23 Oct 2026 in place of a gradient tile with a MapPin icon that
 * three files each drew for themselves.
 *
 * The tab icon, home-screen icon and install icons are files, not this
 * component: src/app/favicon.ico (16/32/48, RGBA, because Turbopack refuses an
 * ICO holding RGB PNGs), src/app/icon.png, src/app/apple-icon.png and
 * src/app/manifest.ts, all from public/brand/.
 */
export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src={size > 96 ? "/brand/missionhq-mark-512.png" : "/brand/missionhq-mark-192.png"}
      alt="MissionHQ"
      width={size}
      height={size}
      priority
      className={`flex-shrink-0 ${className}`}
      style={{ borderRadius: size * 0.28 }}
    />
  );
}

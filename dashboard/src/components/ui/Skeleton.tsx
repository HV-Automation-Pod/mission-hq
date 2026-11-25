/** One grey block. Shimmers; static for reduced motion (see `.po-shimmer` in globals). */
export function Bone({ w, h = 12, soft = false, className = "", style }: {
  w?: number | string; h?: number; soft?: boolean; className?: string; style?: React.CSSProperties;
}) {
  return <div className={`po-shimmer rounded-md ${className}`} style={{ width: w, height: h, backgroundColor: soft ? "#EEF1EF" : "#E3EAE7", ...style }} />;
}

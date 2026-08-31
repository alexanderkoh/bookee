/**
 * The application's mark, used wherever the product names itself.
 *
 * A downscaled copy of `assets/logo.png` — the same artwork as the app icon, so
 * the window and the dock agree. The full-resolution original stays out of the
 * bundle; at 128px this is a few kilobytes and still sharp on a retina display
 * at the sizes it is actually drawn.
 */
import logo from "./logo-mark.png";
import { BRANDING } from "../branding";

export function BrandMark({ size = 22, rounded = true }: { size?: number; rounded?: boolean }) {
  return (
    <img
      src={logo}
      // Decorative: the product name is always written beside it.
      alt=""
      width={size}
      height={size}
      className="brand-mark"
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? Math.round(size * 0.24) : 0,
      }}
    />
  );
}

export { BRANDING };

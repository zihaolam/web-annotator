import type { JSX } from "preact";

type IconProps = { size?: number; class?: string; strokeWidth?: number };

const Svg = ({ size = 14, class: cls, strokeWidth = 2, children }: IconProps & { children: JSX.Element | JSX.Element[] }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconComment = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Svg>
);
export const IconCursor = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
  </Svg>
);
export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  </Svg>
);
export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <path d="M2 2l20 20" />
  </Svg>
);
export const IconChevron = (p: IconProps & { dir?: "up" | "down" | "left" | "right" }) => {
  const rotate = { down: 0, left: 90, up: 180, right: 270 }[p.dir ?? "down"];
  return (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" transform={`rotate(${rotate} 12 12)`} />
    </Svg>
  );
};
export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);
export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
  </Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </Svg>
);
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </Svg>
);
export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </Svg>
);
export const IconLoader = (p: IconProps) => (
  <Svg {...p} class={`animate-spin ${p.class ?? ""}`}>
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Svg>
);

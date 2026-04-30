/* Tiny inline icon components — Radix-style monoline 15x15, currentColor */
const Icon = ({ d, w = 15, h = 15, viewBox = '0 0 15 15', style, fill = false }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={w}
    height={h}
    viewBox={viewBox}
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={fill ? 0 : 1.4}
    strokeLinecap="square"
    style={style}
  >
    {d}
  </svg>
);

const Icons = {
  Check: () => <Icon d={<path d="M11.4 3.6L6.05 9 3.6 6.6" />} />,
  Plus: () => (
    <Icon
      d={
        <>
          <path d="M7.5 3v9" />
          <path d="M3 7.5h9" />
        </>
      }
    />
  ),
  Minus: () => <Icon d={<path d="M3 7.5h9" />} />,
  Chat: () => <Icon d={<path d="M2.5 4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-2.5 2V4z" />} />,
  ChatSolid: () => <Icon fill d={<path d="M2.5 4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-2.5 2V4z" />} />,
  ArrowRight: () => (
    <Icon
      d={
        <>
          <path d="M3 7.5h9" />
          <path d="M8.5 4l3.5 3.5L8.5 11" />
        </>
      }
    />
  ),
  Spark: () => (
    <Icon
      d={
        <>
          <path d="M7.5 2v3" />
          <path d="M7.5 10v3" />
          <path d="M2 7.5h3" />
          <path d="M10 7.5h3" />
          <path d="M3.7 3.7l2 2" />
          <path d="M9.3 9.3l2 2" />
          <path d="M11.3 3.7l-2 2" />
          <path d="M5.7 9.3l-2 2" />
        </>
      }
    />
  ),
  Star: () => <Icon d={<path d="M7.5 2l1.7 3.4 3.8.5-2.7 2.7.6 3.7-3.4-1.8-3.4 1.8.6-3.7L1.9 5.9l3.8-.5z" />} />,
  Sun: () => (
    <Icon
      d={
        <>
          <circle cx="7.5" cy="7.5" r="2.5" />
          <path d="M7.5 1v1.5" />
          <path d="M7.5 12.5v1.5" />
          <path d="M1 7.5h1.5" />
          <path d="M12.5 7.5h14" />
          <path d="M3 3l1 1" />
          <path d="M11 11l1 1" />
          <path d="M12 3l-1 1" />
          <path d="M4 11l-1 1" />
        </>
      }
    />
  ),
  Moon: () => <Icon d={<path d="M12 8.5A5 5 0 0 1 6.5 3a5 5 0 1 0 5.5 5.5z" />} />,
  Branch: () => (
    <Icon
      d={
        <>
          <circle cx="4" cy="4" r="1.3" />
          <circle cx="11" cy="4" r="1.3" />
          <circle cx="4" cy="11" r="1.3" />
          <path d="M4 5.3v4.4" />
          <path d="M11 5.3c0 2.5-2 3.5-4 4" />
        </>
      }
    />
  ),
  PR: () => (
    <Icon
      d={
        <>
          <circle cx="4" cy="4" r="1.3" />
          <circle cx="4" cy="11" r="1.3" />
          <circle cx="11" cy="11" r="1.3" />
          <path d="M4 5.3v4.4" />
          <path d="M11 9.7V7.5a3 3 0 0 0-3-3H6.5" />
          <path d="M8 3l-1.5 1.5L8 6" />
        </>
      }
    />
  ),
  Eye: () => (
    <Icon
      d={
        <>
          <path d="M1 7.5C2.5 4.5 4.8 3 7.5 3s5 1.5 6.5 4.5C12.5 10.5 10.2 12 7.5 12S2.5 10.5 1 7.5z" />
          <circle cx="7.5" cy="7.5" r="1.7" />
        </>
      }
    />
  ),
  Code: () => (
    <Icon
      d={
        <>
          <path d="M5 4l-3 3.5L5 11" />
          <path d="M10 4l3 3.5-3 3.5" />
        </>
      }
    />
  ),
  Story: () => (
    <Icon
      d={
        <>
          <path d="M2 3h11" />
          <path d="M2 7.5h11" />
          <path d="M2 12h7" />
        </>
      }
    />
  ),
  Files: () => (
    <Icon
      d={
        <>
          <path d="M3 2.5h6l3 3v7H3z" />
          <path d="M9 2.5v3h3" />
        </>
      }
    />
  ),
  Refresh: () => (
    <Icon
      d={
        <>
          <path d="M2.5 7.5a5 5 0 0 1 9-3" />
          <path d="M11.5 2v2.5h-2.5" />
          <path d="M12.5 7.5a5 5 0 0 1-9 3" />
          <path d="M3.5 13v-2.5h2.5" />
        </>
      }
    />
  ),
  Send: () => <Icon d={<path d="M13 2L2 6.5l4 1.5L9 5l-1.5 4 1.5 4z" />} />,
  ChevronDown: () => <Icon d={<path d="M3 5.5L7.5 10l4.5-4.5" />} />,
  ChevronRight: () => <Icon d={<path d="M5.5 3L10 7.5 5.5 12" />} />,
  Dot: () => <Icon fill d={<circle cx="7.5" cy="7.5" r="2" />} />,
  X: () => (
    <Icon
      d={
        <>
          <path d="M3 3l9 9" />
          <path d="M12 3l-9 9" />
        </>
      }
    />
  ),
  Github: () => (
    <Icon
      fill
      d={
        <path d="M7.5 1.5a6 6 0 0 0-1.9 11.7c.3.06.4-.13.4-.28v-1c-1.7.36-2-.8-2-.8-.28-.7-.68-.88-.68-.88-.55-.37.04-.36.04-.36.6.04.93.62.93.62.54.93 1.42.66 1.77.5.05-.4.21-.66.39-.81-1.36-.16-2.78-.68-2.78-3a2.34 2.34 0 0 1 .62-1.62 2.16 2.16 0 0 1 .06-1.6s.5-.16 1.65.62a5.7 5.7 0 0 1 3 0c1.15-.78 1.65-.62 1.65-.62.32.82.12 1.43.06 1.6a2.33 2.33 0 0 1 .62 1.62c0 2.32-1.42 2.83-2.78 2.99.22.19.41.55.41 1.1v1.64c0 .16.11.34.41.28A6 6 0 0 0 7.5 1.5z" />
      }
    />
  ),
  Approve: () => (
    <Icon
      d={
        <>
          <circle cx="7.5" cy="7.5" r="5.5" />
          <path d="M5 7.5L7 9.5l3.5-4" />
        </>
      }
    />
  ),
  RequestChanges: () => (
    <Icon
      d={
        <>
          <circle cx="7.5" cy="7.5" r="5.5" />
          <path d="M5 7.5h5" />
        </>
      }
    />
  ),
  Comment: () => <Icon d={<path d="M2.5 4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-2.5 2V4z" />} />,
  Caret: () => <Icon d={<path d="M3 5.5L7.5 10l4.5-4.5" />} />,
  Filter: () => <Icon d={<path d="M2 3h11l-4 5v4l-3-1V8z" />} />,
  Menu: () => (
    <Icon
      d={
        <>
          <path d="M2 4h11" />
          <path d="M2 7.5h11" />
          <path d="M2 11h11" />
        </>
      }
    />
  ),
  Search: () => (
    <Icon
      d={
        <>
          <circle cx="6.5" cy="6.5" r="3.8" />
          <path d="M9.5 9.5l3 3" />
        </>
      }
    />
  ),
};

window.Icons = Icons;

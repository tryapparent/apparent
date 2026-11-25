export const accessoryNames = {
  sunglasses: "Sunglasses",
  "lily-pad": "Flowering lily pad",
  "unicorn-horn": "Unicorn horn",
} as const;

export type Accessory = keyof typeof accessoryNames;

export const accessoryArt = {
  sunglasses: [
    ["#24202c", "M1 5h14v2h-1v3h-4V9H9V7H7v2H6v1H2V7H1z"],
    ["#8c77bc", "M3 6h3v1H3zm8 0h2v1h-2z"],
  ],
  "lily-pad": [
    ["#303b22", "M1 10h2V8h4V7h6v1h2v2h1v2h-2v1H3v-1H1z"],
    ["#6e8439", "M2 10h3V9h7v1h2v1h-2v1H4v-1H2z"],
    ["#8b467c", "M10 6h1V4h2v1h2v2h-1v2h-3V8h-1z"],
    ["#d7a8d5", "M11 5h2v1h1v1h-3z"],
  ],
  "unicorn-horn": [
    ["#4f3b70", "M8 1h2v3h1v3h1v3h1v3H5v-3h1V7h1V4h1z"],
    ["#f5f0e8", "M9 3h1v2H9zm-1 3h2v2H8zm-1 4h4v2H7z"],
    ["#b7a5d8", "M9 5h1v1H9zM8 8h3v2H8z"],
  ],
} as const;

export function FrogAccessory({ item }: { item: Accessory }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="28"
      height="28"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {accessoryArt[item].map(([color, path]) => (
        <path key={color} fill={color} d={path} />
      ))}
    </svg>
  );
}

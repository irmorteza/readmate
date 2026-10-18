import css from "./styles.css?raw";

/** All declarations of every rule whose selector list contains `selector` (comments ignored). */
export function declarations(selector: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) =>
      selectors
        .split(",")
        .map((x) => x.trim())
        .includes(selector),
    )
    .map(([, , body]) => body)
    .join("\n");
}

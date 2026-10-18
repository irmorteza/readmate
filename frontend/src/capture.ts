/** "Take photo" (camera) and "Choose photo" (gallery) buttons backed by hidden file inputs. */
export function createCapture(root: HTMLElement, onFile: (file: File) => void): void {
  const add = (label: string, camera: boolean) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (camera) input.setAttribute("capture", "environment");
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) onFile(file);
      input.value = "";
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = camera ? "primary full" : "secondary full";
    button.textContent = label;
    button.addEventListener("click", () => input.click());
    root.append(input, button);
  };
  add("Take photo", true);
  add("Choose photo", false);
}

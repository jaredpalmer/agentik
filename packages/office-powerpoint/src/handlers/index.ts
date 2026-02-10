import type { BridgeClient } from "@agentik/office-common";
import { handleAddImage } from "./add-image.js";
import { handleAddShape } from "./add-shape.js";
import { handleAddSlide } from "./add-slide.js";
import { handleAddText } from "./add-text.js";
import { handleGetPresentationInfo } from "./get-presentation-info.js";
import { handleModifySlide } from "./modify-slide.js";
import { handleReadSlides } from "./read-slides.js";

type Params = Record<string, unknown>;

export function registerPowerPointHandlers(client: BridgeClient): () => void {
  const unsubs = [
    client.registerToolHandler("read_slides", (_, __, p: Params) =>
      handleReadSlides(p as Parameters<typeof handleReadSlides>[0])
    ),
    client.registerToolHandler("add_slide", (_, __, p: Params) =>
      handleAddSlide(p as Parameters<typeof handleAddSlide>[0])
    ),
    client.registerToolHandler("add_text", (_, __, p: Params) =>
      handleAddText(p as Parameters<typeof handleAddText>[0])
    ),
    client.registerToolHandler("add_shape", (_, __, p: Params) =>
      handleAddShape(p as Parameters<typeof handleAddShape>[0])
    ),
    client.registerToolHandler("add_image", (_, __, p: Params) =>
      handleAddImage(p as Parameters<typeof handleAddImage>[0])
    ),
    client.registerToolHandler("modify_slide", (_, __, p: Params) =>
      handleModifySlide(p as Parameters<typeof handleModifySlide>[0])
    ),
    client.registerToolHandler("get_presentation_info", () => handleGetPresentationInfo()),
  ];
  return () => unsubs.forEach((fn) => fn());
}

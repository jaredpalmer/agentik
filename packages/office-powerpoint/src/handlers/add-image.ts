import type { TextContent } from "@agentik/office-common";

export async function handleAddImage(params: {
  slideIndex: number;
  imageData: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await PowerPoint.run(async (context) => {
      const slide = context.presentation.slides.getItemAt(params.slideIndex);
      // addImage is available at runtime (PowerPointApi 1.12+) but not yet in @types/office-js
      const shapes = slide.shapes as PowerPoint.ShapeCollection & {
        addImage(base64: string, options?: Record<string, number>): PowerPoint.Shape;
      };
      const shape = shapes.addImage(params.imageData, {
        left: params.left ?? 100,
        top: params.top ?? 100,
        width: params.width ?? 400,
        height: params.height ?? 300,
      });
      await context.sync();
      shape.load("name");
      await context.sync();
      return `Added image "${shape.name}" to slide ${params.slideIndex + 1}`;
    });
    return { content: [{ type: "text", text: result }], isError: false };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}

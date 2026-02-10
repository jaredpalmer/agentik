import type { TextContent } from "@agentik/office-common";

export async function handleAddShape(params: {
  slideIndex: number;
  shapeType: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fillColor?: string;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await PowerPoint.run(async (context) => {
      const slide = context.presentation.slides.getItemAt(params.slideIndex);
      const shape = slide.shapes.addGeometricShape(
        params.shapeType as PowerPoint.GeometricShapeType,
        { left: params.left, top: params.top, width: params.width, height: params.height }
      );
      if (params.fillColor) shape.fill.setSolidColor(params.fillColor);
      await context.sync();
      shape.load("name");
      await context.sync();
      return `Added ${params.shapeType} "${shape.name}" to slide ${params.slideIndex + 1}`;
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

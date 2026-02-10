import type { TextContent } from "@agentik/office-common";

export async function handleModifySlide(params: {
  slideIndex: number;
  action: "delete" | "duplicate" | "setBackground" | "deleteShape";
  shapeIndex?: number;
  color?: string;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await PowerPoint.run(async (context) => {
      const slide = context.presentation.slides.getItemAt(params.slideIndex);
      switch (params.action) {
        case "delete":
          slide.delete();
          await context.sync();
          return `Deleted slide ${params.slideIndex + 1}`;
        case "duplicate":
          context.presentation.slides.add();
          await context.sync();
          return `Duplicated slide ${params.slideIndex + 1}`;
        case "setBackground":
          if (!params.color) throw new Error("color required for setBackground");
          slide.background.fill.setSolidFill({ color: params.color });
          await context.sync();
          return `Set background of slide ${params.slideIndex + 1} to ${params.color}`;
        case "deleteShape": {
          if (params.shapeIndex == null) throw new Error("shapeIndex required for deleteShape");
          slide.shapes.load("items");
          await context.sync();
          slide.shapes.items[params.shapeIndex].delete();
          await context.sync();
          return `Deleted shape ${params.shapeIndex} from slide ${params.slideIndex + 1}`;
        }
        default:
          throw new Error(`Unknown action: ${String(params.action)}`);
      }
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

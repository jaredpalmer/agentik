import type { TextContent } from "@agentik/office-common";

export async function handleAddText(params: {
  slideIndex: number;
  text: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  fontSize?: number;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await PowerPoint.run(async (context) => {
      const slide = context.presentation.slides.getItemAt(params.slideIndex);
      const shape = slide.shapes.addTextBox(params.text, {
        left: params.left ?? 100,
        top: params.top ?? 100,
        width: params.width ?? 400,
        height: params.height ?? 50,
      });
      if (params.fontSize) shape.textFrame.textRange.font.size = params.fontSize;
      await context.sync();
      shape.load("name");
      await context.sync();
      return `Added text box "${shape.name}" to slide ${params.slideIndex + 1}`;
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

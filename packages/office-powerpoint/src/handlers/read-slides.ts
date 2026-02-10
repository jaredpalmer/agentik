import type { TextContent } from "@agentik/office-common";

export async function handleReadSlides(params: {
  slideIndex?: number;
  includeNotes?: boolean;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await PowerPoint.run(async (context) => {
      const slides = context.presentation.slides;
      slides.load("items");
      await context.sync();

      const output: string[] = [];
      const targetSlides =
        params.slideIndex != null ? [slides.items[params.slideIndex]] : slides.items;

      for (let i = 0; i < targetSlides.length; i++) {
        const slide = targetSlides[i];
        const slideIdx = params.slideIndex ?? i;
        slide.shapes.load("items");
        await context.sync();

        output.push(`--- Slide ${slideIdx + 1} ---`);
        for (const shape of slide.shapes.items) {
          shape.load("name,type,left,top,width,height");
          if (shape.textFrame) {
            shape.textFrame.load("textRange");
            shape.textFrame.textRange.load("text");
          }
          await context.sync();

          output.push(`  Shape: ${shape.name} (${shape.type})`);
          if (shape.textFrame?.textRange?.text) {
            output.push(`    Text: ${shape.textFrame.textRange.text}`);
          }
        }
      }
      return output.join("\n");
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

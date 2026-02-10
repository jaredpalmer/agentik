import type { TextContent } from "@agentik/office-common";

export async function handleGetPresentationInfo(): Promise<{
  content: TextContent[];
  isError: boolean;
}> {
  try {
    const result = await PowerPoint.run(async (context) => {
      const slides = context.presentation.slides;
      slides.load("items");
      await context.sync();

      const output: string[] = [`Presentation: ${slides.items.length} slides`];
      for (let i = 0; i < slides.items.length; i++) {
        const slide = slides.items[i];
        slide.shapes.load("items");
        await context.sync();
        output.push(`  Slide ${i + 1}: ${slide.shapes.items.length} shapes`);
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

import { z } from "zod";
import type { RemoteToolDefinition } from "../remote-tool.js";

export const powerpointToolDefinitions: RemoteToolDefinition[] = [
  {
    name: "read_slides",
    label: "Read Slides",
    description: "Read the content of slides including shapes, text, and notes.",
    parameters: z.object({
      slideIndex: z.number().optional().describe("Specific slide index (0-based), omit for all"),
      includeNotes: z.boolean().optional().describe("Include speaker notes"),
    }),
  },
  {
    name: "add_slide",
    label: "Add Slide",
    description: "Add a new slide to the presentation.",
    parameters: z.object({
      layout: z.string().optional().describe("Slide layout name"),
      insertAt: z.number().optional().describe("Position to insert (0-based)"),
      title: z.string().optional().describe("Slide title text"),
      body: z.string().optional().describe("Slide body text"),
    }),
  },
  {
    name: "add_text",
    label: "Add Text",
    description: "Add a text box to a slide.",
    parameters: z.object({
      slideIndex: z.number().describe("Target slide index (0-based)"),
      text: z.string().describe("Text content"),
      left: z.number().optional().describe("Left position in points"),
      top: z.number().optional().describe("Top position in points"),
      width: z.number().optional().describe("Width in points"),
      height: z.number().optional().describe("Height in points"),
      fontSize: z.number().optional().describe("Font size in points"),
    }),
  },
  {
    name: "add_shape",
    label: "Add Shape",
    description: "Add a geometric shape to a slide.",
    parameters: z.object({
      slideIndex: z.number().describe("Target slide index (0-based)"),
      shapeType: z.string().describe("Shape type: Rectangle, Oval, Triangle, Diamond, etc."),
      left: z.number().describe("Left position in points"),
      top: z.number().describe("Top position in points"),
      width: z.number().describe("Width in points"),
      height: z.number().describe("Height in points"),
      fillColor: z.string().optional().describe("Fill color hex like #FF0000"),
    }),
  },
  {
    name: "add_image",
    label: "Add Image",
    description: "Add an image to a slide from base64-encoded data.",
    parameters: z.object({
      slideIndex: z.number().describe("Target slide index (0-based)"),
      imageData: z.string().describe("Base64-encoded image data"),
      left: z.number().optional().describe("Left position in points"),
      top: z.number().optional().describe("Top position in points"),
      width: z.number().optional().describe("Width in points"),
      height: z.number().optional().describe("Height in points"),
    }),
  },
  {
    name: "modify_slide",
    label: "Modify Slide",
    description: "Delete, duplicate a slide, set its background, or delete a shape.",
    parameters: z.object({
      slideIndex: z.number().describe("Target slide index (0-based)"),
      action: z.enum(["delete", "duplicate", "setBackground", "deleteShape"]),
      shapeIndex: z.number().optional().describe("Shape index for deleteShape action"),
      color: z.string().optional().describe("Background color hex for setBackground"),
    }),
  },
  {
    name: "get_presentation_info",
    label: "Get Presentation Info",
    description:
      "Get an overview of the presentation including slide count, layouts, and shape inventory.",
    parameters: z.object({}),
  },
];

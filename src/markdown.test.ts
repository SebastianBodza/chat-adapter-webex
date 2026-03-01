import { describe, expect, it } from "vitest";
import { WebexFormatConverter } from "./markdown";

const converter = new WebexFormatConverter();

describe("WebexFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text into a root AST node", () => {
      const ast = converter.toAst("Hello Webex");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses bold markdown", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("converts a simple AST back to markdown string", () => {
      const markdown = converter.fromAst({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Hello Webex" }],
          },
        ],
      });
      expect(markdown).toContain("Hello Webex");
    });

    it("trims trailing whitespace from output", () => {
      const markdown = converter.fromAst({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "trimmed" }],
          },
        ],
      });
      expect(markdown).toBe(markdown.trim());
    });
  });

  describe("roundtrip", () => {
    it("preserves plain text through toAst → fromAst", () => {
      const original = "Hello world";
      const result = converter.fromAst(converter.toAst(original));
      expect(result).toBe(original);
    });

    it("preserves bold text through toAst → fromAst", () => {
      const original = "**bold text**";
      const result = converter.fromAst(converter.toAst(original));
      expect(result).toContain("**bold text**");
    });
  });

  describe("renderPostable", () => {
    it("renders a plain string message directly", () => {
      expect(converter.renderPostable("plain text")).toBe("plain text");
    });

    it("renders raw postable messages", () => {
      expect(converter.renderPostable({ raw: "raw text" })).toBe("raw text");
    });

    it("renders markdown postable messages", () => {
      expect(converter.renderPostable({ markdown: "**bold**" })).toContain(
        "**bold**"
      );
    });

    it("renders AST postable messages via fromAst", () => {
      const ast = converter.toAst("via ast");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("via ast");
    });
  });
});

import { describe, expect, it } from "vitest";
import type {
  ActionsElement,
  CardElement,
  FieldsElement,
  SectionElement,
} from "chat";
import { cardToFallbackText, cardToWebexAdaptiveCard } from "./cards";

describe("cardToWebexAdaptiveCard", () => {
  it("converts card with text and actions to adaptive card", () => {
    const card = {
      type: "card",
      title: "Deployment",
      subtitle: "Ready to proceed",
      children: [
        {
          type: "text",
          content: "Approve the deployment?",
        },
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              value: "yes",
              style: "primary",
            },
            {
              type: "link-button",
              label: "Open Runbook",
              url: "https://example.com/runbook",
              style: "danger",
            },
          ],
        },
      ],
    } as const;

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.type).toBe("AdaptiveCard");
    expect(converted.body.length).toBeGreaterThan(0);
    expect(converted.actions?.length).toBe(2);
    expect(converted.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      title: "Approve",
      style: "positive",
    });
    expect(converted.actions?.[1]).toMatchObject({
      type: "Action.OpenUrl",
      style: "destructive",
    });
  });

  it("omits style when button style is not set", () => {
    const card = {
      type: "card",
      title: "No style",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "plain",
              label: "Plain",
            },
          ],
        },
      ],
    } as const;

    const converted = cardToWebexAdaptiveCard(card);
    const action = converted.actions?.[0] as Record<string, unknown>;
    expect(action.style).toBeUndefined();
  });

  it("renders title and subtitle as TextBlocks", () => {
    const card: CardElement = {
      type: "card",
      title: "My Title",
      subtitle: "My Subtitle",
      children: [],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body[0]).toMatchObject({
      type: "TextBlock",
      text: "My Title",
      weight: "Bolder",
      size: "Medium",
    });
    expect(converted.body[1]).toMatchObject({
      type: "TextBlock",
      text: "My Subtitle",
      isSubtle: true,
    });
  });

  it("omits title/subtitle blocks when not provided", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "text", content: "body only" }],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body).toHaveLength(1);
    expect(converted.body[0]).toMatchObject({ type: "TextBlock", text: "body only" });
  });

  it("renders imageUrl as an Image element", () => {
    const card: CardElement = {
      type: "card",
      title: "With Image",
      imageUrl: "https://example.com/banner.png",
      children: [],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const imageBlock = converted.body.find((b) => b.type === "Image");
    expect(imageBlock).toMatchObject({
      type: "Image",
      url: "https://example.com/banner.png",
      size: "Stretch",
    });
  });

  it("renders image child elements", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "image", url: "https://example.com/photo.jpg", alt: "Photo" },
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body[0]).toMatchObject({
      type: "Image",
      url: "https://example.com/photo.jpg",
      altText: "Photo",
      size: "Auto",
    });
  });

  it("renders divider as a separator Container", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "divider" }],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body[0]).toMatchObject({
      type: "Container",
      separator: true,
    });
  });

  it("renders fields as a FactSet", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "Status", value: "Active" },
            { type: "field", label: "Priority", value: "High" },
          ],
        } as FieldsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body[0]).toMatchObject({
      type: "FactSet",
      facts: [
        { title: "Status", value: "Active" },
        { title: "Priority", value: "High" },
      ],
    });
  });

  it("renders section children inside a Container", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "section",
          children: [
            { type: "text", content: "Inside section" },
          ],
        } as SectionElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body[0]).toMatchObject({
      type: "Container",
      items: [{ type: "TextBlock", text: "Inside section" }],
    });
  });

  it("renders select controls as Input.ChoiceSet with compact style", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "color",
              label: "Color",
              placeholder: "Pick one",
              options: [
                { type: "option", label: "Red", value: "red" },
                { type: "option", label: "Blue", value: "blue" },
              ],
            },
          ],
        } as ActionsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const choiceSet = converted.body.find(
      (b) => b.type === "Input.ChoiceSet"
    );
    expect(choiceSet).toMatchObject({
      id: "color",
      style: "compact",
      placeholder: "Pick one",
    });
    expect(converted.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({ actionId: "color" }),
        }),
      ])
    );
  });

  it("renders radio_select controls with expanded style", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "radio_select",
              id: "plan",
              label: "Plan",
              options: [
                { type: "option", label: "Free", value: "free" },
                { type: "option", label: "Pro", value: "pro" },
              ],
            },
          ],
        } as ActionsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const choiceSet = converted.body.find(
      (b) => b.type === "Input.ChoiceSet"
    );
    expect(choiceSet).toMatchObject({
      id: "plan",
      style: "expanded",
    });
  });

  it("sets initialOption as ChoiceSet value", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "lang",
              label: "Language",
              initialOption: "ts",
              options: [
                { type: "option", label: "TypeScript", value: "ts" },
                { type: "option", label: "JavaScript", value: "js" },
              ],
            },
          ],
        } as ActionsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const choiceSet = converted.body.find(
      (b) => b.type === "Input.ChoiceSet"
    );
    expect(choiceSet?.value).toBe("ts");
  });

  it("marks required selects with isRequired and errorMessage", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "req",
              label: "Required",
              optional: false,
              options: [
                { type: "option", label: "A", value: "a" },
              ],
            },
          ],
        } as ActionsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const choiceSet = converted.body.find(
      (b) => b.type === "Input.ChoiceSet"
    );
    expect(choiceSet?.isRequired).toBe(true);
    expect(choiceSet?.errorMessage).toBe("Please choose an option.");
  });

  it("applies bold and muted text styles", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Bold text", style: "bold" },
        { type: "text", content: "Muted text", style: "muted" },
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body[0]).toMatchObject({ weight: "Bolder" });
    expect(converted.body[1]).toMatchObject({ isSubtle: true });
  });

  it("limits actions array to 20 items", () => {
    const buttons = Array.from({ length: 25 }, (_, i) => ({
      type: "button" as const,
      id: `btn-${i}`,
      label: `Button ${i}`,
    }));

    const card: CardElement = {
      type: "card",
      children: [{ type: "actions", children: buttons } as ActionsElement],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.actions).toHaveLength(20);
  });

  it("ignores unknown child types gracefully", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "unknown_type" } as never,
        { type: "text", content: "Valid" },
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.body).toHaveLength(1);
    expect(converted.body[0]).toMatchObject({ text: "Valid" });
  });

  it("includes $schema and version in output", () => {
    const card: CardElement = { type: "card", children: [] };
    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.$schema).toBe(
      "http://adaptivecards.io/schemas/adaptive-card.json"
    );
    expect(converted.version).toBe("1.3");
  });

  it("omits actions key when there are no actions", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "text", content: "No actions" }],
    };

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.actions).toBeUndefined();
  });

  it("includes button value in submit data when provided", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "btn", label: "Go", value: "val" },
          ],
        } as ActionsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const action = converted.actions?.[0] as Record<string, unknown>;
    expect((action.data as Record<string, string>).value).toBe("val");
  });

  it("omits button value from submit data when not provided", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "btn", label: "Go" },
          ],
        } as ActionsElement,
      ],
    };

    const converted = cardToWebexAdaptiveCard(card);
    const action = converted.actions?.[0] as Record<string, unknown>;
    expect((action.data as Record<string, string>).value).toBeUndefined();
  });
});

describe("cardToFallbackText", () => {
  it("returns plain fallback text for card clients that cannot render cards", () => {
    const card = {
      type: "card",
      title: "Alert",
      children: [{ type: "text", content: "Something happened." }],
    } as const;

    const fallback = cardToFallbackText(card);
    expect(fallback).toContain("Alert");
    expect(fallback).toContain("Something happened.");
  });
});

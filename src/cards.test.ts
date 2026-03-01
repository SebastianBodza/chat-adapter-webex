import { describe, expect, it } from "vitest";
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

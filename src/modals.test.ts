import { describe, expect, it } from "vitest";
import type { ModalElement } from "chat";
import {
  createWebexModalCloseActionId,
  createWebexModalSubmitActionId,
  extractWebexModalValues,
  modalToFallbackText,
  modalToWebexAdaptiveCard,
  parseWebexModalAction,
  WEBEX_MODAL_META_ACTION,
  WEBEX_MODAL_META_CALLBACK_ID,
  WEBEX_MODAL_META_CONTEXT_ID,
  WEBEX_MODAL_META_FLAG,
  WEBEX_MODAL_META_PRIVATE_METADATA,
  WEBEX_MODAL_META_VIEW_ID,
  WEBEX_MODAL_SUBMIT_PREFIX,
  WEBEX_MODAL_CLOSE_PREFIX,
} from "./modals";

describe("createWebexModalSubmitActionId", () => {
  it("creates a prefixed submit action ID from viewId", () => {
    const id = createWebexModalSubmitActionId("view-123");
    expect(id).toBe(`${WEBEX_MODAL_SUBMIT_PREFIX}:view-123`);
  });
});

describe("createWebexModalCloseActionId", () => {
  it("creates a prefixed close action ID from viewId", () => {
    const id = createWebexModalCloseActionId("view-456");
    expect(id).toBe(`${WEBEX_MODAL_CLOSE_PREFIX}:view-456`);
  });
});

describe("modalToFallbackText", () => {
  it("returns title and default submit label", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Feedback Form",
      children: [],
    };
    const text = modalToFallbackText(modal);
    expect(text).toContain("Feedback Form");
    expect(text).toContain("Submit");
  });

  it("uses custom submitLabel in fallback text", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Survey",
      submitLabel: "Send Response",
      children: [],
    };
    const text = modalToFallbackText(modal);
    expect(text).toContain("Send Response");
    expect(text).not.toContain("Submit");
  });
});

describe("modalToWebexAdaptiveCard", () => {
  const metadata = {
    callbackId: "my_callback",
    contextId: "ctx-1",
    privateMetadata: "secret",
    viewId: "view-abc",
  };

  it("includes modal title as a TextBlock", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "My Modal",
      children: [],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    expect(card.type).toBe("AdaptiveCard");
    expect(card.body[0]).toMatchObject({
      type: "TextBlock",
      text: "My Modal",
      weight: "Bolder",
    });
  });

  it("converts text_input children to Input.Text elements", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      children: [
        {
          type: "text_input",
          id: "name",
          label: "Name",
          placeholder: "Enter name",
          multiline: false,
        },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const textInput = card.body.find((b) => b.type === "Input.Text");
    expect(textInput).toMatchObject({
      type: "Input.Text",
      id: "name",
      label: "Name",
      placeholder: "Enter name",
      isMultiline: false,
    });
  });

  it("renders multiline text inputs", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      children: [
        {
          type: "text_input",
          id: "body",
          label: "Body",
          multiline: true,
        },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const textInput = card.body.find((b) => b.type === "Input.Text");
    expect(textInput?.isMultiline).toBe(true);
  });

  it("sets initial value and maxLength on text inputs", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      children: [
        {
          type: "text_input",
          id: "code",
          label: "Code",
          initialValue: "ABC",
          maxLength: 10,
        },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const textInput = card.body.find((b) => b.type === "Input.Text");
    expect(textInput?.value).toBe("ABC");
    expect(textInput?.maxLength).toBe(10);
  });

  it("marks required text inputs with isRequired", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      children: [
        {
          type: "text_input",
          id: "required_field",
          label: "Required",
          optional: false,
        },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const textInput = card.body.find((b) => b.type === "Input.Text");
    expect(textInput?.isRequired).toBe(true);
    expect(textInput?.errorMessage).toContain("Required");
  });

  it("converts select children to Input.ChoiceSet with compact style", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
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
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const choiceSet = card.body.find((b) => b.type === "Input.ChoiceSet");
    expect(choiceSet).toMatchObject({
      type: "Input.ChoiceSet",
      id: "color",
      style: "compact",
      placeholder: "Pick one",
    });
  });

  it("converts radio_select children to expanded ChoiceSet", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
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
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const choiceSet = card.body.find((b) => b.type === "Input.ChoiceSet");
    expect(choiceSet).toMatchObject({
      style: "expanded",
    });
  });

  it("converts text children to TextBlock elements", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Info",
      children: [
        { type: "text", content: "Some instructions" },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const textBlocks = card.body.filter(
      (b) => b.type === "TextBlock" && b.text === "Some instructions"
    );
    expect(textBlocks).toHaveLength(1);
  });

  it("applies bold and muted text styles", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Styled",
      children: [
        { type: "text", content: "Bold", style: "bold" },
        { type: "text", content: "Muted", style: "muted" },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const bold = card.body.find((b) => b.text === "Bold");
    const muted = card.body.find((b) => b.text === "Muted");
    expect(bold?.weight).toBe("Bolder");
    expect(muted?.isSubtle).toBe(true);
  });

  it("converts fields children to FactSet", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Details",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "Status", value: "Open" },
          ],
        },
      ],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const factSet = card.body.find((b) => b.type === "FactSet");
    expect(factSet).toBeDefined();
    expect((factSet?.facts as Array<{ title: string }>)[0].title).toBe("Status");
  });

  it("includes submit action with modal metadata", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      children: [],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const submitAction = card.actions?.find(
      (a) =>
        (a.data as Record<string, string>)?.[WEBEX_MODAL_META_ACTION] ===
        "submit"
    );
    expect(submitAction).toBeDefined();
    const data = submitAction?.data as Record<string, string>;
    expect(data[WEBEX_MODAL_META_FLAG]).toBe("1");
    expect(data[WEBEX_MODAL_META_VIEW_ID]).toBe("view-abc");
    expect(data[WEBEX_MODAL_META_CALLBACK_ID]).toBe("my_callback");
    expect(data[WEBEX_MODAL_META_CONTEXT_ID]).toBe("ctx-1");
    expect(data[WEBEX_MODAL_META_PRIVATE_METADATA]).toBe("secret");
  });

  it("includes cancel action when closeLabel is set", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      closeLabel: "Cancel",
      children: [],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    const closeAction = card.actions?.find(
      (a) =>
        (a.data as Record<string, string>)?.[WEBEX_MODAL_META_ACTION] ===
        "close"
    );
    expect(closeAction).toBeDefined();
    expect(closeAction?.title).toBe("Cancel");
  });

  it("includes cancel action when notifyOnClose is set", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      notifyOnClose: true,
      children: [],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    expect(card.actions?.length).toBe(2);
  });

  it("omits cancel action when neither closeLabel nor notifyOnClose is set", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      children: [],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    expect(card.actions).toHaveLength(1);
  });

  it("uses custom submitLabel on the submit action", () => {
    const modal: ModalElement = {
      type: "modal",
      callbackId: "cb",
      title: "Form",
      submitLabel: "Send",
      children: [],
    };

    const card = modalToWebexAdaptiveCard(modal, metadata);
    expect(card.actions?.[0].title).toBe("Send");
  });
});

describe("parseWebexModalAction", () => {
  it("returns null for non-modal inputs", () => {
    const result = parseWebexModalAction({
      actionId: "regular_action",
      value: "test",
    });
    expect(result).toBeNull();
  });

  it("detects submit action from actionId prefix", () => {
    const result = parseWebexModalAction({
      actionId: `${WEBEX_MODAL_SUBMIT_PREFIX}:view-1`,
    });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("submit");
    expect(result?.viewId).toBe("view-1");
  });

  it("detects close action from actionId prefix", () => {
    const result = parseWebexModalAction({
      actionId: `${WEBEX_MODAL_CLOSE_PREFIX}:view-1`,
    });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("close");
    expect(result?.viewId).toBe("view-1");
  });

  it("detects modal from _chat_modal flag", () => {
    const result = parseWebexModalAction({
      actionId: "some_action",
      [WEBEX_MODAL_META_FLAG]: "1",
      [WEBEX_MODAL_META_ACTION]: "submit",
      [WEBEX_MODAL_META_VIEW_ID]: "view-2",
      [WEBEX_MODAL_META_CALLBACK_ID]: "callback_1",
    });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("submit");
    expect(result?.viewId).toBe("view-2");
    expect(result?.callbackId).toBe("callback_1");
  });

  it("extracts contextId and privateMetadata from inputs", () => {
    const result = parseWebexModalAction({
      actionId: `${WEBEX_MODAL_SUBMIT_PREFIX}:view-3`,
      [WEBEX_MODAL_META_FLAG]: "1",
      [WEBEX_MODAL_META_ACTION]: "submit",
      [WEBEX_MODAL_META_VIEW_ID]: "view-3",
      [WEBEX_MODAL_META_CALLBACK_ID]: "cb",
      [WEBEX_MODAL_META_CONTEXT_ID]: "ctx-99",
      [WEBEX_MODAL_META_PRIVATE_METADATA]: "private_data",
    });
    expect(result?.contextId).toBe("ctx-99");
    expect(result?.privateMetadata).toBe("private_data");
  });

  it("respects _chat_modal_action over prefix-inferred kind", () => {
    const result = parseWebexModalAction({
      actionId: `${WEBEX_MODAL_SUBMIT_PREFIX}:view-1`,
      [WEBEX_MODAL_META_FLAG]: "1",
      [WEBEX_MODAL_META_ACTION]: "close",
      [WEBEX_MODAL_META_VIEW_ID]: "view-1",
    });
    expect(result?.kind).toBe("close");
  });

  it("returns undefined contextId and privateMetadata when empty", () => {
    const result = parseWebexModalAction({
      actionId: `${WEBEX_MODAL_SUBMIT_PREFIX}:view-1`,
      [WEBEX_MODAL_META_CONTEXT_ID]: "",
      [WEBEX_MODAL_META_PRIVATE_METADATA]: "",
    });
    expect(result?.contextId).toBeUndefined();
    expect(result?.privateMetadata).toBeUndefined();
  });
});

describe("extractWebexModalValues", () => {
  it("strips modal metadata keys and returns user values", () => {
    const values = extractWebexModalValues({
      actionId: `${WEBEX_MODAL_SUBMIT_PREFIX}:view-1`,
      [WEBEX_MODAL_META_FLAG]: "1",
      [WEBEX_MODAL_META_ACTION]: "submit",
      [WEBEX_MODAL_META_VIEW_ID]: "view-1",
      [WEBEX_MODAL_META_CALLBACK_ID]: "cb",
      [WEBEX_MODAL_META_CONTEXT_ID]: "ctx",
      [WEBEX_MODAL_META_PRIVATE_METADATA]: "pm",
      feedback: "Great product",
      category: "feature",
    });

    expect(values).toEqual({
      feedback: "Great product",
      category: "feature",
    });
  });

  it("strips source, value, _actionId, id, and action keys", () => {
    const values = extractWebexModalValues({
      _actionId: "test",
      id: "test",
      action: "test",
      source: "select",
      value: "val",
      realField: "real",
    });

    expect(values).toEqual({ realField: "real" });
  });

  it("returns empty object when all keys are metadata", () => {
    const values = extractWebexModalValues({
      actionId: "test",
      [WEBEX_MODAL_META_FLAG]: "1",
    });

    expect(values).toEqual({});
  });
});

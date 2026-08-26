"use client";

/**
 * One turn, rendered from its parts.
 *
 * The bubble treatment is lifted from components/booking/MessageThread — the
 * app already has a chat idiom and the assistant should not invent a second
 * one. What is new is the middle layer: tool parts render as activity lines,
 * deep links as buttons, product results as rows.
 *
 * Tool part state is read carefully. `input` only exists once the model has
 * finished streaming its arguments, and `output` only after the tool has run,
 * so both are read behind their state checks rather than optimistically.
 */

import { isToolUIPart, getToolName, type UIMessage } from "ai";
import { ToolActivity } from "./ToolActivity";
import { DeepLinkCard, isDeepLink } from "./DeepLinkCard";
import { ProductSuggestions, type SuggestedProduct } from "./ProductSuggestions";

/** Tools whose output is a product list worth showing as rows. */
const PRODUCT_TOOLS = new Set([
  "searchProducts",
  "recommendProductsForPet",
]);

function productsFrom(output: unknown): SuggestedProduct[] {
  if (typeof output !== "object" || output === null) return [];
  const list = (output as { products?: unknown }).products;
  return Array.isArray(list) ? (list as SuggestedProduct[]) : [];
}

export function AssistantMessage({ message }: { message: UIMessage }) {
  const mine = message.role === "user";

  const bubbles = message.parts.map((part, index) => {
    if (part.type === "text") {
      if (!part.text.trim()) return null;
      return (
        <div
          key={`${message.id}-${index}`}
          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
            mine ? "self-end bg-ink text-white" : "self-start bg-fog text-charcoal"
          }`}
        >
          {part.text}
        </div>
      );
    }

    if (isToolUIPart(part)) {
      const toolName = getToolName(part);
      const done = part.state === "output-available";
      const failed = part.state === "output-error";

      // A deep link is the whole point of the call — render it, not the fact
      // that a tool ran.
      if (done && isDeepLink(part.output)) {
        return (
          <div key={part.toolCallId} className="max-w-[85%] self-start">
            <DeepLinkCard link={part.output} />
          </div>
        );
      }

      if (done && PRODUCT_TOOLS.has(toolName)) {
        const products = productsFrom(part.output);
        if (products.length > 0) {
          return (
            <div key={part.toolCallId} className="max-w-[85%] self-start">
              <ToolActivity toolName={toolName} done />
              <ProductSuggestions products={products} />
            </div>
          );
        }
      }

      return (
        <div key={part.toolCallId} className="max-w-[85%] self-start">
          <ToolActivity toolName={toolName} done={done} failed={failed} />
        </div>
      );
    }

    return null;
  });

  return <>{bubbles}</>;
}

"use client";

import { forwardRef, useEffect, useRef, useState } from "react";

const initialMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hello! I'm the QueryGPT assistant. How can I help you today?",
};

const defaultEndpoint = `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/query/`;

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date instanceof Date ? date : new Date(date));
}

function truncateText(text, limit = 320) {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trim()}...`;
}

function htmlToPlainText(html) {
  const documentFragment = new DOMParser().parseFromString(html, "text/html");
  const messageParagraph = Array.from(documentFragment.querySelectorAll("p"))
    .map((paragraph) => paragraph.textContent?.trim())
    .find((text) => text?.toLowerCase().startsWith("message:"));
  const heading = documentFragment.querySelector("h1")?.textContent?.trim();
  const bodyText = documentFragment.body?.textContent?.replace(/\s+/g, " ").trim();

  return messageParagraph || heading || bodyText || "";
}

function extractReply(payload) {
  if (typeof payload === "string") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return "The API returned an empty response.";
  }

  const directKeys = ["reply", "response", "answer", "message", "text", "output"];
  for (const key of directKeys) {
    if (typeof payload[key] === "string" && payload[key].trim()) {
      return payload[key];
    }
  }

  if (payload.data) {
    return extractReply(payload.data);
  }

  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const firstChoice = payload.choices[0];
    return extractReply(firstChoice?.message ?? firstChoice);
  }

  return JSON.stringify(payload, null, 2);
}

function extractErrorMessage(response, payload) {
  const fallback = `Request failed with status ${response.status}`;

  if (typeof payload === "string") {
    const text = payload.trim();
    const looksLikeHtml = /^<!doctype html/i.test(text) || /^<html/i.test(text);
    const readableText = looksLikeHtml ? htmlToPlainText(text) : text;
    const message = readableText.replace(/^message:\s*/i, "").trim();

    return message ? `${fallback}: ${truncateText(message)}` : fallback;
  }

  const reply = extractReply(payload).trim();
  return reply ? `${fallback}: ${truncateText(reply)}` : fallback;
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function PebbleTag({ children, tone = "violet" }) {
  return <span className={`pebble-tag pebble-tag-${tone}`}>{children}</span>;
}

function PebbleLoader({ scale = 1 }) {
  return (
    <span className="pebble-loader" style={{ transform: `scale(${scale})` }} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function PebbleButton({ children, loading = false, type = "button", variant = "primary", ...props }) {
  const disabled = props.disabled || loading;

  return (
    <button
      className={`pebble-button pebble-button-${variant}`}
      type={type}
      {...props}
      disabled={disabled}
    >
      {loading ? <PebbleLoader scale={0.36} /> : children}
    </button>
  );
}

const PebbleTextArea = forwardRef(function PebbleTextArea(
  { hasValue, loading, label, ...props },
  ref,
) {
  return (
    <div className="pebble-input pebble-input-textarea" data-has-value={hasValue}>
      <div className="pebble-input-control">
        <textarea {...props} ref={ref} />
        {loading ? <PebbleLoader scale={0.34} /> : null}
      </div>
      <label htmlFor={props.id}>{label}</label>
      <div className="pebble-input-highlight" />
    </div>
  );
});

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableLine(line) {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

function isSeparatorLine(line) {
  return /^\|[\s\-|:]+\|$/.test(line.trim());
}

function parseContentBlocks(content) {
  const lines = content.split("\n");
  const blocks = [];
  let textLines = [];
  let tableLines = [];
  let inTable = false;

  for (const line of lines) {
    if (isTableLine(line)) {
      if (!inTable) {
        if (textLines.length > 0) {
          blocks.push({ type: "text", content: textLines.join("\n") });
          textLines = [];
        }
        inTable = true;
      }
      tableLines.push(line);
    } else {
      if (inTable) {
        blocks.push({ type: "table", lines: tableLines });
        tableLines = [];
        inTable = false;
      }
      textLines.push(line);
    }
  }

  if (inTable && tableLines.length > 0) {
    blocks.push({ type: "table", lines: tableLines });
  } else if (textLines.length > 0) {
    blocks.push({ type: "text", content: textLines.join("\n") });
  }

  return blocks;
}

function MarkdownTable({ lines }) {
  const nonSeparator = lines.filter((l) => !isSeparatorLine(l));
  if (nonSeparator.length < 2) return null;

  const [headerLine, ...dataLines] = nonSeparator;
  const headers = parseTableRow(headerLine);
  const rows = dataLines.map(parseTableRow);

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageContent({ content }) {
  const blocks = parseContentBlocks(content);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "table") {
          return <MarkdownTable key={i} lines={block.lines} />;
        }
        const paragraphs = block.content.split(/\n{2,}/);
        return paragraphs
          .filter((p) => p.trim())
          .map((para, j) => <p key={`${i}-${j}`}>{para.replace(/\n/g, " ")}</p>);
      })}
    </>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === "user";
  const className = [
    "message",
    isUser ? "user-message" : "bot-message",
    message.error ? "error-message" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className}>
      <div className="avatar" aria-hidden="true">
        {isUser ? "You" : "AI"}
      </div>
      <div className="message-body">
        <div className="bubble">
          <MessageContent content={message.content} />
        </div>
        {message.timestamp && (
          <time className="message-meta" dateTime={new Date(message.timestamp).toISOString()}>
            {formatTime(message.timestamp)}
          </time>
        )}
      </div>
    </article>
  );
}

function TypingIndicator() {
  return (
    <article className="message bot-message typing">
      <div className="avatar" aria-hidden="true">
        AI
      </div>
      <div className="bubble" aria-label="Waiting for response">
        <PebbleLoader scale={0.42} />
      </div>
    </article>
  );
}

export default function Home() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([initialMessage]);
  const [sessionId, setSessionId] = useState(createSessionId);
  const [status, setStatus] = useState("Ready");
  const [isErrorStatus, setIsErrorStatus] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isSending]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft]);

  async function sendMessage(message) {
    const response = await fetch(defaultEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain;q=0.9",
      },
      body: JSON.stringify({
        query: message,
        session_id: sessionId,
      }),
    });

    const payload = await readResponse(response);

    if (!response.ok) {
      throw new Error(extractErrorMessage(response, payload));
    }

    return extractReply(payload);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const message = draft.trim();
    if (!message || isSending) {
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setStatus("Thinking…");
    setIsErrorStatus(false);

    try {
      const reply = await sendMessage(message);
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply,
          timestamp: new Date(),
        },
      ]);
      setStatus("Ready");
      setIsErrorStatus(false);
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error.message || "Something went wrong.",
          error: true,
          timestamp: new Date(),
        },
      ]);
      setStatus("Request failed");
      setIsErrorStatus(true);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  function clearChat() {
    setMessages([initialMessage]);
    setSessionId(createSessionId());
    setStatus("Ready");
    setIsErrorStatus(false);
    textareaRef.current?.focus();
  }

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-label="QueryGPT Chat">
        <header className="chat-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <span />
            </div>
            <div className="brand-text">
              <h1>QueryGPT</h1>
            </div>
            <PebbleTag tone={isErrorStatus ? "red" : isSending ? "yellow" : "emerald"}>
              {status}
            </PebbleTag>
          </div>
          <PebbleButton variant="secondary" type="button" onClick={clearChat}>
            New chat
          </PebbleButton>
        </header>

        <div className="messages" ref={messagesRef} aria-live="polite" aria-relevant="additions">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {isSending ? <TypingIndicator /> : null}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="messageInput">
            Message
          </label>
          <PebbleTextArea
            id="messageInput"
            name="message"
            ref={textareaRef}
            rows={1}
            label="Ask a question"
            placeholder="Type your message…"
            autoComplete="off"
            required
            value={draft}
            hasValue={draft.trim().length > 0}
            loading={isSending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <PebbleButton type="submit" loading={isSending} disabled={!draft.trim()}>
            Send
          </PebbleButton>
          <p className="composer-hint">
            Press <kbd>Enter</kbd> to send &nbsp;·&nbsp; <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
          </p>
        </form>
      </section>
    </main>
  );
}

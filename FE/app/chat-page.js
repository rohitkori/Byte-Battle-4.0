"use client";

import { Children, cloneElement, forwardRef, isValidElement, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const initialMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hello! I'm the QueryGPT assistant. How can I help you today?",
};

const defaultEndpoint = `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/query/`;

function chatHistoryEndpoint(sessionId) {
  return `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/chat/${encodeURIComponent(sessionId)}`;
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

function messagesFromChatHistory(payload, sessionId) {
  if (!payload || !Array.isArray(payload.chats) || payload.chats.length === 0) {
    return [initialMessage];
  }

  return [
    initialMessage,
    ...payload.chats.flatMap((chat, index) => {
      const timestamp = chat.timestamp ? new Date(chat.timestamp) : new Date();
      return [
        {
          id: `${sessionId}-${index}-request`,
          role: "user",
          content: chat.request || "",
          timestamp,
        },
        {
          id: `${sessionId}-${index}-response`,
          role: "assistant",
          content: chat.response || "",
          timestamp,
        },
      ];
    }),
  ];
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

function PebbleLinkButton({ children, variant = "primary", ...props }) {
  return (
    <a className={`pebble-button pebble-button-${variant}`} {...props}>
      {children}
    </a>
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

function csvEscape(value) {
  const text = value.replace(/\s+/g, " ").trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTableAsCsv(event) {
  const wrapper = event.currentTarget.closest(".table-wrapper");
  const table = wrapper?.querySelector("table");
  if (!table) {
    return;
  }

  const rows = Array.from(table.querySelectorAll("thead tr, tbody tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td"))
        .map((cell) => csvEscape(cell.textContent ?? ""))
        .join(","),
    )
    .filter(Boolean);

  if (rows.length === 0) {
    return;
  }

  const blob = new Blob([`${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `querygpt-table-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getTableRowCellCount(row) {
  if (!isValidElement(row)) {
    return 1;
  }

  return Math.max(Children.count(row.props.children), 1);
}

function LimitedTableBody({ children }) {
  const rows = Children.toArray(children);
  const visibleRows = 10;
  const hiddenRowCount = Math.max(rows.length - visibleRows, 0);
  const columnCount = rows.reduce(
    (maxCount, row) => Math.max(maxCount, getTableRowCellCount(row)),
    1,
  );

  return (
    <>
      <tbody>
        {rows.map((row, index) => {
          if (!isValidElement(row)) {
            return row;
          }

          const className = [
            row.props.className,
            index >= visibleRows ? "table-row-hidden" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return cloneElement(row, { className });
        })}
      </tbody>
      {hiddenRowCount > 0 ? (
        <tfoot>
          <tr>
            <td className="table-more-rows" colSpan={columnCount}>
              {hiddenRowCount} more {hiddenRowCount === 1 ? "row" : "rows"}. Download CSV to view full results.
            </td>
          </tr>
        </tfoot>
      ) : null}
    </>
  );
}

const markdownComponents = {
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrapper">
        <div className="table-actions">
          <button
            type="button"
            className="table-download-button"
            onClick={downloadTableAsCsv}
            aria-label="Download table as CSV"
            title="Download CSV"
          >
            <Download size={20} strokeWidth={2.8} aria-hidden="true" />
          </button>
        </div>
        <table className="data-table">{children}</table>
      </div>
    );
  },
  tbody({ children }) {
    return <LimitedTableBody>{children}</LimitedTableBody>;
  },
};

function PlainMessageContent({ content }) {
  return content
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph, index) => <p key={index}>{paragraph.replace(/\n/g, " ")}</p>);
}

function MarkdownMessageContent({ content }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MessageContent({ content, markdown = false }) {
  return markdown ? (
    <MarkdownMessageContent content={content} />
  ) : (
    <PlainMessageContent content={content} />
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
          <MessageContent content={message.content} markdown={!isUser && !message.error} />
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

export default function ChatPage({ sessionId }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([initialMessage]);
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
    let isCurrent = true;

    async function loadChatHistory() {
      try {
        const response = await fetch(chatHistoryEndpoint(sessionId), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "ngrok-skip-browser-warning": "true",
          },
        });

        if (response.status === 404) {
          return;
        }

        const payload = await readResponse(response);

        if (!response.ok) {
          throw new Error(extractErrorMessage(response, payload));
        }

        if (isCurrent) {
          setMessages(messagesFromChatHistory(payload, sessionId));
        }
      } catch (error) {
        if (isCurrent) {
          setStatus("History unavailable");
          setIsErrorStatus(true);
        }
      }
    }

    loadChatHistory();

    return () => {
      isCurrent = false;
    };
  }, [sessionId]);

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
        "ngrok-skip-browser-warning": "true",
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
          <PebbleLinkButton variant="secondary" href="/">
            New chat
          </PebbleLinkButton>
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

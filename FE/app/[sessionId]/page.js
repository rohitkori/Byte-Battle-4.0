import ChatPage from "../chat-page";

export default async function SessionPage({ params }) {
  const { sessionId } = await params;

  return <ChatPage sessionId={sessionId} />;
}

import type { APIEvent } from "@solidjs/start/server"

export function GET(event: APIEvent) {
  return Response.json({ message: "Hello, world!" })
}

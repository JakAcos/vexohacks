#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RelayClient } from "./relay-client.js";
import { createRelayMcpServer } from "./server.js";

const client = new RelayClient({ baseUrl: process.env.RELAY_URL, accessToken: process.env.RELAY_ACCESS_TOKEN });
await createRelayMcpServer(client).connect(new StdioServerTransport());
// stdout is the MCP channel; log only to stderr.
console.error(`relay-mission MCP server ready (Relay at ${client.baseUrl})`);

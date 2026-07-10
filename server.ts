import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const server = new Server(
  { name: "stockly-ai-tools", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "verificar_estoque",
        description: "Busca produtos no banco de dados para verificar preço e quantidade disponível em estoque.",
        inputSchema: {
          type: "object",
          properties: {
            busca: { type: "string", description: "Nome ou termo de busca do produto (ex: Camiseta)" }
          },
          required: ["busca"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "verificar_estoque") {
      const busca = args?.busca as string;
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, description")
        .ilike("name", `%${busca}%`);

      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    throw new Error(`Ferramenta não encontrada: ${name}`);
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Erro ao executar ferramenta: ${err.message}` }]
    };
  }
});

const app = express();
let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Transporte não inicializado");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

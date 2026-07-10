import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createClient } from "@supabase/supabase-js";

// 1. Inicializa o servidor MCP
const server = new McpServer({
  name: "Agente Kah Presentes",
  version: "1.0.0",
});

// 2. Configura a conexão com o seu banco de dados Supabase via variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. Cadastra a ferramenta de estoque
server.tool(
  "verificar_estoque",
  "Busca produtos no estoque da loja de presentes. Permite filtrar por nome do produto.",
  {},
  async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, description, price, stock");

      if (error) {
        return {
          content: [{ type: "text", text: `Erro ao acessar o banco de dados: ${error.message}` }],
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: "Nenhum produto cadastrado no estoque atualmente." }],
        };
      }

      const listaProdutos = data
        .map(
          (p) =>
            `- *${p.name}*: R$ ${p.price} | Qtd: ${p.stock} unidades\n  Descrição: ${p.description || "Sem descrição"}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Aqui estão os produtos encontrados no estoque:\n\n${listaProdutos}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Erro interno no servidor MCP: ${err.message}` }],
      };
    }
  }
);

// 4. Configura o servidor Express (Padrão original com rotas separadas)
const app = express();

let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("Conexão GET recebida em /sse");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  console.log("Mensagem POST recebida em /messages");
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Transporte não inicializado");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando perfeitamente na porta ${port}`);
});

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
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
      },
      {
        name: "buscar_ou_criar_cliente",
        description: "Verifica se o cliente já existe no CRM pelo número do WhatsApp. Se não existir, cria o cadastro.",
        inputSchema: {
          type: "object",
          properties: {
            telefone: { type: "string", description: "Número do WhatsApp do cliente com DDI e DDD (ex: 5534999999999)" },
            nome: { type: "string", description: "Nome do cliente (caso seja necessário cadastrar)" }
          },
          required: ["telefone"]
        }
      },
      {
        name: "criar_pedido_pdv",
        description: "Cria um novo pedido no módulo de PDV/Vendas do sistema para o cliente.",
        inputSchema: {
          type: "object",
          properties: {
            customer_id: { type: "string", description: "ID do cliente retornado pela ferramenta de CRM" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  product_id: { type: "string", description: "ID do produto" },
                  quantity: { type: "number", description: "Quantidade comprada" },
                  unit_price: { type: "number", description: "Preço unitário do produto" }
                },
                required: ["product_id", "quantity", "unit_price"]
              }
            },
            total_amount: { type: "number", description: "Valor total do pedido" }
          },
          required: ["customer_id", "items", "total_amount"]
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

    if (name === "buscar_ou_criar_cliente") {
      const telefone = args?.telefone as string;
      const nome = (args?.nome as string) || "Cliente WhatsApp";

      const { data: existente, error: searchError } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("phone", telefone)
        .single();

      if (existente) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "encontrado", cliente: existente }) }] };
      }

      const { data: novo, error: insertError } = await supabase
        .from("customers")
        .insert([{ name: nome, phone: telefone }])
        .select()
        .single();

      if (insertError) throw insertError;
      return { content: [{ type: "text", text: JSON.stringify({ status: "criado", cliente: novo }) }] };
    }

    if (name === "criar_pedido_pdv") {
      const customer_id = args?.customer_id as string;
      const items = args?.items as any[];
      const total_amount = args?.total_amount as number;

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert([{ customer_id, total_amount, status: "pending" }])
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItemsPayload = items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItemsPayload);

      if (itemsError) throw itemsError;

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ status: "sucesso", order_id: order.id, mensagem: "Pedido criado aguardando pagamento." }) 
        }]
      };
    }

    throw new Error(`Ferramenta não encontrada: ${name}`);
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Erro ao executar ferramenta: ${err.message}` }]
    };
  }
});

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const transport = new StdioServerTransport();
await server.connect(transport);
console.log("Servidor MCP Stockly rodando com sucesso!");

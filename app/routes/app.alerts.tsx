import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const alerts = await prisma.alert.findMany({
    where: { shopId: shop.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return {
    alerts: alerts.map((a) => ({
      id: a.id,
      severity: a.severity,
      type: a.type,
      title: a.title,
      message: a.message,
      status: a.status,
      at: a.createdAt.toISOString(),
      feedRunId: a.feedRunId,
    })),
  };
};

export default function Alerts() {
  const { alerts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <s-page heading="Alerts">
      <s-section>
        {alerts.length === 0 ? (
          <s-paragraph>No alerts. You are all clear.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {alerts.map((a) => (
              <s-box key={a.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-300">
                  <s-stack direction="inline" gap="base">
                    <s-badge tone={a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info"}>
                      {a.severity}
                    </s-badge>
                    <s-badge tone={a.status === "resolved" ? "success" : "neutral"}>{a.status}</s-badge>
                    <s-text>{new Date(a.at).toLocaleString()}</s-text>
                  </s-stack>
                  <s-heading>{a.title}</s-heading>
                  <s-text>{a.message}</s-text>
                  <s-stack direction="inline" gap="base">
                    {a.feedRunId && <s-link href={`/app/runs/${a.feedRunId}`}>Open run</s-link>}
                    {a.status !== "read" && a.status !== "resolved" && (
                      <fetcher.Form method="post" action={`/app/actions/alerts/${a.id}/read`}>
                        <s-button type="submit" variant="tertiary">
                          Mark read
                        </s-button>
                      </fetcher.Form>
                    )}
                    {a.status !== "resolved" && (
                      <fetcher.Form method="post" action={`/app/actions/alerts/${a.id}/resolve`}>
                        <s-button type="submit" variant="tertiary">
                          Resolve
                        </s-button>
                      </fetcher.Form>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);

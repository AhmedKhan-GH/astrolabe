This document is internal commercial strategy. Keep it out of any public copy of the repository.

# Open Core

This document records the commercial direction from November 17, 2026. The host license remains open.

## Commercial Basis

The open core covers local work with the person's own API keys or local models. Paid products cover server services, team use, and curated expertise. This boundary preserves a useful local app and places commercial value in services and methods.

Expertise becomes a product advantage when the workflow retains it. Corrections become checks, and runs add history and evaluations. Research becomes part of the tools, as Caliper's interventions and J-space trace illustrate. Open-source tools, published research, and useful books build distribution and trust. Native GPU rendering, browser views, and real-time streaming provide a technical advantage, but that advantage alone does not last.

An open contract lets other authors add tools to Astrolabe. Each tool increases the host's usefulness. Agent Monitor provides an entry point because it collects subscription limits in one standalone interface. The open components are easy to copy, while the paid services and curated methods carry the commercial value.

## Open Source Core

The open core includes `astrolabe-contract` and the Artisan kit. The contract lets other authors implement tools, and the kit supplies shared interface components. Repo Monitor and Agent Monitor serve as open reference tools.

The host app also belongs in the open core. It includes the local shell, command layer, panels, and agent runner. The person supplies API keys or uses local models. Local operation does not require a paid server.

## Paid Products

The proposed paid products are Astrolabe Pro and Team through the shared backend. The sources call that backend Alidade. Its name remains open because Alidade also names the learning platform.

Sync provides end-to-end encryption across devices. Hosted agents support scheduled and long runs while the person's Mac sleeps. Team services provide shared workspaces, tool settings, agent policies, an audit log, and SSO.

Expert tools carry curated methods. Examples include the Atlas writing loop from `PROCESS.md` for long documents, research pipelines from paper to experiment, and Caliper inside Astrolabe. Caliper remains a separate product that Astrolabe embeds.

A team model gateway provides budgets and routing across Claude, Codex, Kimi, and GLM. Agent Monitor's view across providers provides the basis for this service. The gateway belongs in the paid services.

## License Reasoning

The contract and the Artisan kit should use permissive licenses. This choice removes license barriers for tool authors. The sources do not select specific licenses for these components.

A permissive host license is also an option. The November 17 reasoning treats a fork of the local desktop app as a smaller commercial risk than resale of hosted services. The server components remain closed under this split.

The sources also consider a source-available host license that becomes open after two years, such as the Functional Source License. This option aims to restrict hosted resellers that compete with the service, but it can reduce outside contributions. The host license remains an open decision.

## Release Order

First, complete the shared kit and put the tools on `astrolabe-contract`. This follows the [consolidation order](direction.md#consolidation-order).

Next, open the contract and Agent Monitor when the contract becomes stable. Before release, replace the Agent Monitor screenshot that exposes real repository names. Open the host when someone other than the founder can use it.

Start the paid tier when sync or hosted agents exist. That step requires accounts and billing from the shared backend. Build billing and licensing when the first customer is ready to pay.

## Commercial Priorities

Keep Astrolabe internal at first as the founder's productivity app. A later version for one profession, such as research engineers who use Caliper, remains a possibility. The first external release focuses on Agent Monitor within the interfaces layer.

Commercialize Caliper first because its market is narrower and its expertise provides a stronger advantage. Its app remains free and open source. Paid services cover the hub, synced run history, shared recordings, run comparisons, hosted interventions, and a commercial license for Caliper Embed. Astrolabe can follow when it hosts Caliper as an expert tool.

Use published Alioth results from Caliper to demonstrate the product and establish trust. Seek three to five design partners in machine learning and interpretability research teams for paid pilots. Those pilots fund development, test demand, and supply feedback that improves the product.

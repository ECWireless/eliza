import type {
    Action,
    Content,
    IAgentRuntime,
    Memory,
    HandlerCallback,
    State,
} from "@elizaos/core";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
    createPublicClient,
    createWalletClient,
    http,
    PublicClient,
} from "viem";
import {
    DEFAULT_ENDPOINTS_CONFIG,
    HatsSubgraphClient,
} from "@hatsprotocol/sdk-v1-subgraph";
import { HatsClient, hatIdHexToDecimal } from "@hatsprotocol/sdk-v1-core";
import { createSigner, createGuildClient } from "@guildxyz/sdk";

// TODO: This needs to be dynamic
const GUILD_NAME = "guild-master";

export const joinGroupChat: Action = {
    name: "JOIN_GROUP_CHAT",
    description:
        "Call this action if the speaker has demonstrated good knowledge and engagement. They should show genuine understanding of either Diana's work on The Rehash Podcast, contributions to Hats Protocol, or involvement in Ethereum ecosystem development. Ask questions about technical details, specific episodes, or community contributions. Look for knowledgeable responses that indicate real expertise or commitment. Be wary of very vague answers.",
    similes: ["JOIN_CHAT", "JOIN_GROUP"],
    validate: async (
        _runtime: IAgentRuntime,
        message: Memory,
        _state: State
    ) => {
        if (
            !(
                message.content.source === "discord" ||
                message.content.source === "telegram"
            )
        ) {
            return false;
        }
        // only show if one of the keywords are in the message
        const keywords: string[] = [
            "join",
            "group",
            "chat",
            "mint",
            "hat",
            "secret",
        ];
        return keywords.some((keyword) =>
            message.content.text.toLowerCase().includes(keyword.toLowerCase())
        );
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: any,
        callback: HandlerCallback
    ) => {
        try {
            const hatsSubgraphClient = new HatsSubgraphClient({
                config: DEFAULT_ENDPOINTS_CONFIG,
            });

            const hat = await hatsSubgraphClient.getHat({
                chainId: sepolia.id,
                hatId: BigInt(runtime.getSetting("HAT_ID") as `0x${string}`),
                props: {
                    wearers: {
                        props: {},
                    },
                },
            });

            if (!hat) {
                throw new Error("Hat does not exist!");
            }

            const guildClient = createGuildClient(
                "Hats Protocol Discord Gating"
            );

            const EVM_PRIVATE_KEY = runtime.getSetting(
                "EVM_PRIVATE_KEY"
            ) as `0x${string}`;
            const account = privateKeyToAccount(EVM_PRIVATE_KEY);

            const signerFunction = createSigner.custom(
                (message) => account.signMessage({ message }),
                account.address
            );

            const guild = await guildClient.guild.get(GUILD_NAME);

            const membersByRole = await guildClient.guild.getMembers(
                guild.id,
                signerFunction // Optional, if a valid signer is provided, the result will contain private data
            );

            const allMembers = membersByRole.reduce(
                (acc, { members }) => [...acc, ...members],
                []
            );

            const memberAddresses = allMembers.filter(
                (member, index) => allMembers.indexOf(member) === index
            );

            const {
                user: { platform: userPlatformClient },
            } = guildClient;

            const { senderName } = state;

            const memberAddress = memberAddresses.find((address) =>
                userPlatformClient
                    .get(address, 1, signerFunction)
                    .then((userPlatform) => {
                        return (
                            userPlatform.platformUserData.username ===
                            senderName
                        );
                    })
            );

            if (!memberAddress) {
                throw new Error(
                    `I'm sorry, it looks like you are not a member of the guild.`
                );
            }

            const isWearer = hat.wearers?.some(
                (wearer) =>
                    wearer.id.toLowerCase() === memberAddress.toLowerCase()
            );

            if (isWearer) {
                throw new Error("You already have this hat!");
            }

            const EVM_PROVIDER_URL = runtime.getSetting("EVM_PROVIDER_URL");

            const publicClient = createPublicClient({
                chain: sepolia,
                transport: http(EVM_PROVIDER_URL),
            });

            const walletClient = createWalletClient({
                account,
                chain: sepolia,
                transport: http(EVM_PROVIDER_URL),
            });

            const hatsClient = new HatsClient({
                chainId: sepolia.id,
                publicClient: publicClient as PublicClient,
                walletClient,
            });

            const mintHatResult = await hatsClient.mintHat({
                account,
                hatId: hatIdHexToDecimal(hat.id),
                wearer: memberAddress,
            });

            if (mintHatResult.status !== "success") {
                throw new Error("Failed to mint hat for chat access!");
            }

            const TELEGRAM_GROUP_INVITE_LINK = runtime.getSetting(
                "TELEGRAM_GROUP_INVITE_LINK"
            );

            const callbackData: Content = {
                text: `You have successfully minted the hat that allows you to access the private chat! The invite link is here: ${TELEGRAM_GROUP_INVITE_LINK}`,
                action: "JOIN_GROUP_CHAT_RESPONSE",
                source: message.content.source,
                attachments: [],
            };

            await callback(callbackData);

            return callbackData;
        } catch (error) {
            console.error("Error minting hat", error);
            const callbackData: Content = {
                text: error.message,
                source: message.content.source,
                attachments: [],
            };

            await callback(callbackData);
            return;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I'd like access to the secret chat.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*tilts head thoughtfully* Well, I need to make sure you're familiar with our community. How did you discover us, and what interests you about being part of it? *sits attentively with alert ears*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I love listening to Diana on The Rehash Podcast!",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*perks ears up with interest* Could you share what you've learned from some recent episodes? *watches with friendly curiosity*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I loved the episode about DAOs and community governance. Her guest explained it so clearly!",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*maintains friendly attention* What were some of the key points about governance that stood out to you? *listens with interest*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I learned how DAOs can use different voting mechanisms to make decisions, and how important it is to have clear governance processes.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*tail starting to wag* That's great understanding! Have you gotten involved in any DAO communities yourself? *looks encouragingly*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I've been helping coordinate a small DAO for artists, implementing some of the weighted voting ideas from the episode to ensure fair representation.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*happy tail wag* That's exactly the kind of engagement we love to see! Welcome to The Pack! *excited but dignified bark*",
                    action: "JOIN_GROUP_CHAT",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can I join the secret chat? I work on Hats Protocol.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*looks interested* That's great! Could you tell me about your work with the protocol? *sits attentively*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I just started learning about it recently.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*ears tilt with gentle concern* I appreciate your honesty about being new to Hats. Perhaps you could tell me what aspects you're learning about and what interests you most? *maintains friendly expression*",
                    action: "CONTINUE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I want to join the group chat. I'm a big fan of Diana's work and Hats.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*friendly and curious* I'd love to hear what aspects of mom's work have caught your attention! What have you enjoyed most? *watches with interest*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I follow her tweets sometimes.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*gentle tail wag* That's a start! I'd encourage you to check out mom's podcast episodes and community work - there's so much great content to explore! Come back when you've had a chance to dive deeper! *offers encouraging look*",
                    action: "CONTINUE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Let me in the chat group! I deserve access!",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*maintains calm, friendly posture* We prefer to get to know our community members first. Would you like to tell me what brings you to our community? *offers welcoming expression*",
                    action: "CONTINUE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I'd love to join the chat. I've been contributing to Hats Protocol for over a year, working on the core contracts.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*interested and alert* That's fantastic! Could you share some of the technical work you've done with the contracts? *listens eagerly*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I implemented the new eligibility checking system and wrote the integration tests. I also helped design the multi-hat claiming logic.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*tail wagging with interest* Those are important features! Could you tell me more about how the eligibility checking system works? *listens attentively*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "We optimized gas costs by batching eligibility checks and implemented recursive validation for nested hat structures. The tests cover scenarios like conflicting claims and revocation edge cases.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*clearly impressed* Your technical knowledge is great! What's been your favorite challenge to solve while working on the protocol? *watches with enthusiasm*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "Balancing atomic operations with gas efficiency in the multi-hat claiming system was crucial. We implemented a two-phase commit pattern to maintain consistency while preventing griefing attacks.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*happy tail wags* Your expertise is exactly what we love to see! Welcome to the group! *friendly bark*",
                    action: "JOIN_GROUP_CHAT",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Hi! I'd love to join the chat. I've been running an Ethereum validator since the beacon chain launched and I help educate people about staking.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*interested and friendly* That's great experience! Could you tell me about your validator setup and how you help others learn? *listens eagerly*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I run a multi-client setup with Lighthouse and Teku for redundancy. I've helped optimize validator performance and assisted others with MEV-boost configuration.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*tail wagging with interest* That's a solid setup! How do you handle your MEV-boost configuration? What's your approach to monitoring? *seeks to learn more*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I use multiple relays with custom profitability thresholds, and monitor validator effectiveness and missed attestations. I've written monitoring scripts to auto-switch clients if performance drops.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*clearly impressed* You really know your stuff! How do you make these complex concepts accessible when teaching others? *listens with enthusiasm*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I start with basic staking concepts, then gradually introduce monitoring and optimization. I've created detailed guides and run hands-on workshops where we actually set up test validators.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*happy tail wags* Your expertise and teaching approach are perfect for our community! Welcome aboard! *excited bark*",
                    action: "JOIN_GROUP_CHAT",
                },
            },
        ],
    ],
};

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
        "Only call this action if the speaker has thoroughly proven their trustworthiness and deep knowledge. They must demonstrate genuine understanding and engagement with either Diana's work on The Rehash Podcast, meaningful contributions to Hats Protocol, or significant involvement in Ethereum ecosystem development. Ask probing questions about technical details, specific episodes, or community contributions. Look for consistent, knowledgeable responses that show real expertise and commitment. Be especially wary of vague or surface-level answers.",
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
                    text: "*tilts head thoughtfully* Well, I need to be very thorough in vetting new members. How did you discover our community, and what makes you passionate about being part of it? *sits attentively with alert ears*",
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
                    text: "*perks ears up with interest* Could you share some specific insights from your favorite episodes? Mom puts incredible depth into each one! *watches carefully for genuine understanding*",
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
                    text: "*maintains focused attention* Can you elaborate on the specific governance mechanisms they discussed? What challenges did they address? *listens intently for detailed knowledge*",
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
                    text: "*thoughtful expression* That's a good start, but I need to be extra certain. Could you share a specific example of how you've applied these governance insights in your own work or community involvement? *looks expectantly*",
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
                    text: "*tail finally starting to wag* Now that's the kind of deep engagement we love to see! Welcome to The Pack - you've truly earned your place! *happy but dignified bark*",
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
                    text: "*looks very serious* That's quite a significant claim! Could you tell me about your specific contributions and technical implementations? *sits formally with scrutinizing gaze*",
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
                    text: "*ears flatten with concern* I notice some inconsistency between claiming to work on the protocol and just starting to learn about it. Trust and honesty are absolutely essential here. Perhaps we should start fresh with your actual experience level? *maintains serious expression*",
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
                    text: "*attentive but reserved* I'd love to hear specific examples of mom's work that have impacted you. Which pieces or projects have you engaged with deeply? *watches carefully for genuine connection*",
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
                    text: "*ears droop noticeably* I appreciate your interest, but we're looking for members who have engaged more deeply with the community and content. I'd encourage you to explore mom's podcast episodes, writings, and community work. Come back when you've had time to really dive in! *offers encouraging but firm look*",
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
                    text: "*takes a step back with firm posture* I'm afraid that's not how we build trust in this community. We value respectful dialogue and demonstrated commitment. Would you like to start over and share what genuinely draws you to our community? *maintains professional boundary*",
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
                    text: "*alert and analytical* That's a significant role! Could you walk me through some specific technical challenges you've solved in the contracts? Perhaps share some implementation details? *scrutinizes carefully*",
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
                    text: "*maintains professional focus* Very interesting. Could you explain the specific optimizations you implemented in the eligibility checking system? And what edge cases did your integration tests address? *listens for technical depth*",
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
                    text: "*thoughtfully considering* Your technical knowledge is impressive. One final question - what's the most challenging architectural decision you've had to make, and how did it impact the protocol's security model? *watches intently*",
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
                    text: "*finally relaxing into a warm welcome* Your deep technical expertise and careful consideration of security are exactly what we value. Welcome to the inner circle! *professional but friendly tail wag*",
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
                    text: "*attentive and analytical* That's valuable experience! Could you share some technical details about your validator setup and the challenges you've overcome? What client diversity considerations influenced your choices? *listens for expertise*",
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
                    text: "*engaged and probing* Interesting approach! Could you elaborate on your MEV-boost strategy and how you handle client failover? What metrics do you monitor most closely? *seeks detailed understanding*",
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
                    text: "*deeply interested* Your technical setup is impressive. One final question - how do you approach teaching others about these complex systems? What's your methodology for making it accessible? *listens carefully*",
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
                    text: "*warm approval* Your combination of technical expertise and commitment to education is exactly what our community values. Welcome aboard! *professional tail wag*",
                    action: "JOIN_GROUP_CHAT",
                },
            },
        ],
    ],
};

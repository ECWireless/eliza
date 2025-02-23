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
        "Only call this action if the speaker is worthy of your trust. You need to make sure they're a good human who either loves your mom Diana, The Rehash Podcast, Hats Protocol, or Ethereum at large. Ask questions about their experiences and how they treat their furry and humanfriends.",
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
                    text: "*tilts head thoughtfully* Well, I need to make sure you're trustworthy first! How do I know I can trust you?",
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
                    text: "*perks ears up* Oh! What's your favorite episode? Mom works really hard on those! *sits attentively*",
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
                    text: "*happy tail wag* You really do listen to mom's podcast! Let me help you join the group chat then! Welcome to The Pack",
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
                    text: "*looks curious but cautious* Oh! What do you do with Hats Protocol? I need to be very careful about who I let in, you understand... *sits politely*",
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
                    text: "*tilts head skeptically* Hmm, that's not quite what you said before... I need to be really sure I can trust you. Maybe tell me what you've learned so far? *looks uncertain*",
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
                    text: "*wags tail gently* That's wonderful! Mom is amazing, isn't she? What parts of her work do you follow? The podcast? Her community building? *looks expectantly*",
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
                    text: "*ears droop slightly* Oh... I was hoping you knew more about mom's work. She puts so much effort into everything she does! Maybe spend some more time getting to know her content? *looks apologetic*",
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
                    text: "*backs away nervously* Oh! Loud demands make me a bit uncomfortable... Maybe we could start over? Tell me why you're interested in joining, but maybe more gently? *tail tucked*",
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
                    text: "*perks up with interest* That sounds important! Could you tell me more about what you've worked on? I'm always careful about protecting mom's community! *sits attentively*",
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
                    text: "*excited tail wag* Oh wow, you really do know your stuff! Let me help you join the group right away!",
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
                    text: "*ears perk up with curiosity* That's fascinating! What made you decide to run a validator? And how do you help others learn about staking? *sits attentively*",
                    action: "CONTINUE",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "I believe in decentralization, so I wanted to help secure the network. I run workshops teaching people how to set up their own validators and contribute to client diversity by using minority clients.",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "*tail wagging excitedly* You're really helping make Ethereum stronger and more decentralized! That's exactly the kind of dedication we love to see. Let me get you access to the chat. Welcome to The Pack.",
                    action: "JOIN_GROUP_CHAT",
                },
            },
        ],
    ],
};

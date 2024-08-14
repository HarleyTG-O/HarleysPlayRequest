const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID, NOTIFICATION_CHANNEL_ID, REPORT_CHANNEL_ID, GAMES } = require('./config.json');
const fs = require('fs');

const path = './ban.json'; // Path to the ban file
const playRequestsPath = './playRequests.json'; // Path to the play requests file

const playRequests = new Map();

// Function to read banned users from ban.json
const readBannedUsers = () => {
    try {
        const data = fs.readFileSync(path, 'utf8');
        return JSON.parse(data).bannedUsers || [];
    } catch (error) {
        console.error('Error reading banned users:', error);
        return [];
    }
};

// Function to write banned users to ban.json
const writeBannedUsers = (bannedUsers) => {
    try {
        fs.writeFileSync(path, JSON.stringify({ bannedUsers }, null, 2));
    } catch (error) {
        console.error('Error writing banned users:', error);
    }
};

// Function to read play requests from playRequests.json
const readPlayRequests = () => {
    try {
        const data = fs.readFileSync(playRequestsPath, 'utf8');
        return new Map(Object.entries(JSON.parse(data)));
    } catch (error) {
        console.error('Error reading play requests:', error);
        return new Map();
    }
};

// Function to write play requests to playRequests.json
const writePlayRequests = (playRequests) => {
    try {
        const data = Object.fromEntries(playRequests);
        fs.writeFileSync(playRequestsPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing play requests:', error);
    }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', async () => {
    console.log('Started refreshing application (/) commands.');

    const commands = [
        {
            name: 'play',
            description: 'Request to play a game',
            options: [
                {
                    type: 3, // STRING
                    name: 'game',
                    description: 'The game you want to play',
                    required: true,
                    choices: Object.keys(GAMES).map(game => ({ name: game, value: game }))
                }
            ]
        },
        {
            name: 'playend',
            description: 'End a play request',
            options: [
                {
                    type: 3, // STRING
                    name: 'id',
                    description: 'The ID of the play request to end',
                    required: true
                }
            ]
        },
        {
            name: 'ban',
            description: 'Ban a user from making play requests',
            options: [
                {
                    type: 6, // USER
                    name: 'user',
                    description: 'The user to ban',
                    required: true
                },
                {
                    type: 3, // STRING
                    name: 'reason',
                    description: 'The reason for banning',
                    required: true
                }
            ]
        },
        {
            name: 'unban',
            description: 'Unban a user from making play requests',
            options: [
                {
                    type: 3, // STRING
                    name: 'user',
                    description: 'The ID of the user to unban',
                    required: true
                }
            ]
        },
        {
            name: 'report',
            description: 'Report a play request',
            options: [
                {
                    type: 3, // STRING
                    name: 'id',
                    description: 'The ID of the play request to report',
                    required: true
                },
                {
                    type: 3, // STRING
                    name: 'reason',
                    description: 'The reason for reporting',
                    required: true
                }
            ]
        }
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error reloading application (/) commands:', error);
    }

    // Load play requests from file
    const loadedPlayRequests = readPlayRequests();
    loadedPlayRequests.forEach((value, key) => {
        playRequests.set(key, value);
    });

    console.log(`Logged in as ${client.user.tag}!`);
});

const createPreviewEmbed = (playRequestId, game, status, users) => {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Play Request Preview')
        .setDescription(`**Play Request ID:** ${playRequestId}\n**Status:** ${status}\n**Game:** ${game}`)
        .setImage(GAMES[game]);

    if (status === 'Accepted' || status === 'Denied') {
        embed.addFields({
            name: 'Users',
            value: users.map(userId => `<@${userId}>`).join(', ')
        });
    }

    return embed;
};

const createActionRow = (playRequestId) => {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_${playRequestId}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`deny_${playRequestId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`report_${playRequestId}`)
                .setLabel('Report')
                .setStyle(ButtonStyle.Secondary)
        );
};

const createReportModal = (playRequestId) => {
    return new ModalBuilder()
        .setCustomId(`report_${playRequestId}`)
        .setTitle('Report Play Request')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            )
        );
};

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction || (!interaction.isCommand() && !interaction.isButton() && !interaction.isModalSubmit())) {
            throw new Error('Invalid interaction.');
        }

        if (interaction.isCommand()) {
            const { commandName } = interaction;

            if (commandName === 'play') {
                if (interaction.replied || interaction.deferred) {
                    return; // Interaction already replied or deferred
                }

                await interaction.deferReply(); // Defer the reply to allow more processing time

                const bannedUsers = readBannedUsers();
                if (bannedUsers.includes(interaction.user.id)) {
                    return interaction.editReply({ content: 'You are banned from making play requests!' });
                }

                const game = interaction.options.getString('game');
                const playRequestId = `PR#${Math.floor(Math.random() * 999999).toString().padStart(6, '0')}`;
                const requester = interaction.user.id;

                if (!GAMES[game]) {
                    return interaction.editReply({ content: 'Game not found!' });
                }

                const mainEmbed = createPreviewEmbed(playRequestId, game, 'Pending', []);
                const actionRow = createActionRow(playRequestId);

                // Send the embed to the notification channel
                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const notificationMessage = await notificationChannel.send({ embeds: [mainEmbed], components: [actionRow] });

                playRequests.set(playRequestId, {
                    userId: interaction.user.id,
                    game,
                    status: 'Pending',
                    acceptedBy: new Set(),
                    deniedBy: new Set(),
                    notificationMessageId: notificationMessage.id
                });
                writePlayRequests(playRequests);

                await interaction.followUp({ content: `Play request for ${game} has been created!`, ephemeral: true });
            } else if (commandName === 'playend') {
                const playRequestId = interaction.options.getString('id');
                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
                }

                playRequests.delete(playRequestId);
                writePlayRequests(playRequests);

                // Delete the message from the notification channel
                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                if (message) {
                    await message.delete();
                }

                return interaction.reply({ content: `Play request ${playRequestId} has been ended.`, ephemeral: true });
            } else if (commandName === 'ban') {
                const userId = interaction.options.getUser('user').id;
                const reason = interaction.options.getString('reason');

                const bannedUsers = readBannedUsers();
                if (!bannedUsers.includes(userId)) {
                    bannedUsers.push(userId);
                    writeBannedUsers(bannedUsers);

                    return interaction.reply({ content: `User <@${userId}> has been banned. Reason: ${reason}`, ephemeral: true });
                }

                return interaction.reply({ content: 'User is already banned.', ephemeral: true });
            } else if (commandName === 'unban') {
                const userId = interaction.options.getString('user');

                const bannedUsers = readBannedUsers();
                if (bannedUsers.includes(userId)) {
                    const index = bannedUsers.indexOf(userId);
                    bannedUsers.splice(index, 1);
                    writeBannedUsers(bannedUsers);

                    return interaction.reply({ content: `User <@${userId}> has been unbanned.`, ephemeral: true });
                }

                return interaction.reply({ content: 'User is not banned.', ephemeral: true });
            } else if (commandName === 'report') {
                const playRequestId = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
                }

                const reportEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Play Request Report')
                    .setDescription(`**Play Request ID:** ${playRequestId}\n**Requester:** <@${playRequest.userId}>\n**Reason:** ${reason}`)
                    .setFooter({ text: `Reported by: ${interaction.user.tag}` });

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                await reportChannel.send({ embeds: [reportEmbed] });

                return interaction.reply({ content: 'Play Request has been reported.', ephemeral: true });
            }
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
            }

            switch (action) {
                case 'accept':
                    if (!playRequest.acceptedBy.has(interaction.user.id)) {
                        playRequest.acceptedBy.add(interaction.user.id);
                        playRequest.status = 'Accepted';

                        const previewEmbed = createPreviewEmbed(playRequestId, playRequest.game, 'Accepted', Array.from(playRequest.acceptedBy));
                        const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                        const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                        await message.edit({ embeds: [previewEmbed] });

                        await interaction.reply({ content: 'Play request accepted.', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'You have already accepted this request.', ephemeral: true });
                    }
                    break;

                case 'deny':
                    if (!playRequest.deniedBy.has(interaction.user.id)) {
                        playRequest.deniedBy.add(interaction.user.id);
                        playRequest.status = 'Denied';

                        const previewEmbed = createPreviewEmbed(playRequestId, playRequest.game, 'Denied', Array.from(playRequest.deniedBy));
                        const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                        const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                        await message.edit({ embeds: [previewEmbed] });

                        await interaction.reply({ content: 'Play request denied.', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'You have already denied this request.', ephemeral: true });
                    }
                    break;

                case 'report':
                    await interaction.showModal(createReportModal(playRequestId));
                    break;

                default:
                    await interaction.reply({ content: 'Unknown action.', ephemeral: true });
                    break;
            }

            playRequests.set(playRequestId, playRequest);
            writePlayRequests(playRequests);
        } else if (interaction.isModalSubmit()) {
            const playRequestId = interaction.customId.split('_')[1];
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
            }

            if (interaction.customId.startsWith('report_')) {
                const reason = interaction.fields.getTextInputValue('reason');

                const reportEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Play Request Report')
                    .setDescription(`**Play Request ID:** ${playRequestId}\n**Requester:** <@${playRequest.userId}>\n**Reason:** ${reason}`)
                    .setFooter({ text: `Reported by: ${interaction.user.tag}` });

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                await reportChannel.send({ embeds: [reportEmbed] });

                await interaction.reply({ content: 'Play Request has been reported.', ephemeral: true });
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
    }
});

client.login(TOKEN);

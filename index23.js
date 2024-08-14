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

// Function to create the main embed
const createMainEmbed = (playRequestId, game, status, users) => {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Play Request')
        .setDescription(`**Play Request ID:** ${playRequestId}\n**Status:** ${status}\n**Game:** ${game}`)
        .setImage(GAMES[game])
        .addFields({
            name: 'Users',
            value: users.length > 0 ? users.map(userId => `<@${userId}>`).join(', ') : 'N/A'
        });
};

// Function to create the preview embed
const createPreviewEmbed = (playRequestId, game, status, users) => {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Play Request Preview')
        .setDescription(`**Play Request ID:** ${playRequestId}\n**Status:** ${status}\n**Game:** ${game}`)
        .setImage(GAMES[game])
        .addFields({
            name: 'Users',
            value: users.length > 0 ? users.map(userId => `<@${userId}>`).join(', ') : 'N/A'
        });
};

// Function to create the report embed
const createReportEmbed = (playRequestId, game, requester, reason) => {
    return new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Play Request Report')
        .setDescription(`**Play Request:** ${game}\n**Play Request ID:** ${playRequestId}\n**Requester:** ${requester}\n**Reason:** ${reason}\n**Reported by:** <@${requester}>`)
        .addFields(
            { name: 'Actions', value: 'Click the buttons below to take action.' }
        );
};

// Function to create action rows for main and report embeds
const createActionRow = (playRequestId, type) => {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`${type}_accept_${playRequestId}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`${type}_deny_${playRequestId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`${type}_report_${playRequestId}`)
                .setLabel('Report')
                .setStyle(ButtonStyle.Secondary)
        );
};

// Function to create a report action row
const createReportActionRow = (playRequestId) => {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`report_delete_${playRequestId}`)
                .setLabel('Delete Request')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`report_ban_${playRequestId}`)
                .setLabel('Ban Requester')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`report_warn_${playRequestId}`)
                .setLabel('Warn Requester')
                .setStyle(ButtonStyle.Primary)
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

                const game = interaction.options.getString('game');
                const playRequestId = `PR#${Math.floor(Math.random() * 1000000)}`;
                const requester = interaction.user.id;

                // Create the play request object
                const playRequest = {
                    id: playRequestId,
                    game: game,
                    userId: requester,
                    status: 'Pending',
                    acceptedBy: new Set(),
                    deniedBy: new Set(),
                    notificationMessageId: null
                };

                playRequests.set(playRequestId, playRequest);
                writePlayRequests(playRequests);

                // Create the preview embed for DM
                const previewEmbed = createPreviewEmbed(playRequestId, game, 'Pending', []);

                // DM the requester with the play request details
                const user = await client.users.fetch(requester);
                await user.send({ embeds: [previewEmbed] });

                // Create the main embed with buttons
                const mainEmbed = createMainEmbed(playRequestId, game, 'Pending', []);
                const actionRow = createActionRow(playRequestId, 'main');

                // Send the main embed to the notification channel
                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const message = await notificationChannel.send({ embeds: [mainEmbed], components: [actionRow] });
                playRequest.notificationMessageId = message.id;

                // Update play request with the message ID
                playRequests.set(playRequestId, playRequest);
                writePlayRequests(playRequests);

                await interaction.editReply({ content: `Play request ${playRequestId} has been created.`, ephemeral: true });
            } else if (commandName === 'playend') {
                const playRequestId = interaction.options.getString('id');

                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
                }

                playRequests.delete(playRequestId);
                writePlayRequests(playRequests);

                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                if (message) {
                    await message.delete();
                }

                return interaction.reply({ content: `Play request ${playRequestId} has been ended.`, ephemeral: true });
            } else if (commandName === 'ban') {
                const userId = interaction.options.getUser('user').id;
                const reason = interaction.options.getString('reason');

                let bannedUsers = readBannedUsers();
                if (!bannedUsers.includes(userId)) {
                    bannedUsers.push(userId);
                    writeBannedUsers(bannedUsers);

                    return interaction.reply({ content: `User <@${userId}> has been banned. Reason: ${reason}`, ephemeral: true });
                }

                return interaction.reply({ content: `User <@${userId}> is already banned.`, ephemeral: true });
            } else if (commandName === 'unban') {
                const userId = interaction.options.getString('user');

                let bannedUsers = readBannedUsers();
                bannedUsers = bannedUsers.filter(id => id !== userId);
                writeBannedUsers(bannedUsers);

                return interaction.reply({ content: `User <@${userId}> has been unbanned.`, ephemeral: true });
            } else if (commandName === 'report') {
                const playRequestId = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
                }

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                const reportEmbed = createReportEmbed(playRequestId, playRequest.game, `<@${playRequest.userId}>`, reason);
                const reportActionRow = createReportActionRow(playRequestId);

                await reportChannel.send({ embeds: [reportEmbed], components: [reportActionRow] });

                return interaction.reply({ content: `Play request ${playRequestId} has been reported.`, ephemeral: true });
            }
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
            }

            if (action === 'accept') {
                playRequest.acceptedBy.add(interaction.user.id);
                playRequest.status = 'Accepted';
                writePlayRequests(playRequests);

                const previewEmbed = createPreviewEmbed(playRequestId, playRequest.game, 'Accepted', [...playRequest.acceptedBy]);
                const actionRow = createActionRow(playRequestId, 'main');

                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                if (message) {
                    await message.edit({ embeds: [previewEmbed], components: [actionRow] });
                }

                // DM the requester with the update
                const user = await client.users.fetch(playRequest.userId);
                await user.send({ embeds: [previewEmbed] });

                await interaction.reply({ content: 'You have accepted the play request!', ephemeral: true });
            } else if (action === 'deny') {
                playRequest.deniedBy.add(interaction.user.id);
                playRequest.status = 'Denied';
                writePlayRequests(playRequests);

                const previewEmbed = createPreviewEmbed(playRequestId, playRequest.game, 'Denied', [...playRequest.deniedBy]);
                const actionRow = createActionRow(playRequestId, 'main');

                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                if (message) {
                    await message.edit({ embeds: [previewEmbed], components: [actionRow] });
                }

                // DM the requester with the update
                const user = await client.users.fetch(playRequest.userId);
                await user.send({ embeds: [previewEmbed] });

                await interaction.reply({ content: 'You have denied the play request!', ephemeral: true });
            } else if (action === 'report') {
                const modal = createReportModal(playRequestId);
                await interaction.showModal(modal);
            } else if (action === 'delete') {
                playRequests.delete(playRequestId);
                writePlayRequests(playRequests);

                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const message = await notificationChannel.messages.fetch(playRequest.notificationMessageId);
                if (message) {
                    await message.delete();
                }

                await interaction.reply({ content: 'Play request has been deleted.', ephemeral: true });
            } else if (action === 'ban') {
                const bannedUsers = readBannedUsers();
                const userId = playRequest.userId;

                if (!bannedUsers.includes(userId)) {
                    bannedUsers.push(userId);
                    writeBannedUsers(bannedUsers);

                    await interaction.reply({ content: `User <@${userId}> has been banned.`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `User <@${userId}> is already banned.`, ephemeral: true });
                }
            } else if (action === 'warn') {
                const user = await client.users.fetch(playRequest.userId);
                await user.send('You have been warned for your play request.');

                await interaction.reply({ content: 'User has been warned.', ephemeral: true });
            }
        } else if (interaction.isModalSubmit()) {
            if (!interaction.customId.startsWith('report_')) {
                return;
            }

            const playRequestId = interaction.customId.split('_')[1];
            const reason = interaction.fields.getTextInputValue('reason');

            const playRequest = playRequests.get(playRequestId);
            if (!playRequest) {
                return interaction.reply({ content: 'Play Request not found.', ephemeral: true });
            }

            const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
            const reportEmbed = createReportEmbed(playRequestId, playRequest.game, `<@${playRequest.userId}>`, reason);
            const reportActionRow = createReportActionRow(playRequestId);

            await reportChannel.send({ embeds: [reportEmbed], components: [reportActionRow] });

            await interaction.reply({ content: 'Thank you for your report!', ephemeral: true });
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
    }
});

client.login(TOKEN);

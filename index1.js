const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID, NOTIFICATION_CHANNEL_ID, REPORT_CHANNEL_ID, GAMES } = require('./config.json');
const fs = require('fs');
const path = './ban.json'; // Path to the ban file
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const playRequests = new Map();

// Function to read banned users from ban.json
const readBannedUsers = () => {
    try {
        const data = fs.readFileSync(path, 'utf8');
        return JSON.parse(data).bannedUsers;
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

    console.log(`Logged in as ${client.user.tag}!`);
});

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

const updateRequesterPreview = async (playRequestId, status) => {
    try {
        const playRequest = playRequests.get(playRequestId);
        if (!playRequest) {
            throw new Error('Play request not found.');
        }

        const requester = await client.users.fetch(playRequest.userId);
        if (requester) {
            const requesterDm = await requester.createDM();
            const acceptUsers = [...playRequest.acceptedBy].map(id => `<@${id}>`).join(', ') || 'None';
            const denyUsers = [...playRequest.deniedBy].map(id => `<@${id}>`).join(', ') || 'None';

            const previewEmbed = new EmbedBuilder()
                .setColor(status === 'Accepted' ? '#00ff00' : '#ff0000')
                .setTitle('Play Request Preview')
                .setDescription(`Your play request ID: ${playRequestId}\n\nStatus: ${status}`)
                .addFields(
                    { name: `${status === 'Accepted' ? 'Accepted User(s)' : 'Denied User(s)'}`, value: status === 'Accepted' ? acceptUsers : denyUsers }
                )
                .setImage(GAMES[playRequest.game]);

            await requesterDm.send({ embeds: [previewEmbed] });
        }
    } catch (error) {
        console.error('Error updating requester preview:', error);
    }
};

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction || (!interaction.isCommand() && !interaction.isButton() && !interaction.isModalSubmit())) {
            throw new Error('Invalid interaction.');
        }

        if (interaction.isCommand()) {
            const { commandName } = interaction;

            if (commandName === 'play') {
                const bannedUsers = readBannedUsers();
                if (bannedUsers.includes(interaction.user.id)) {
                    return interaction.reply({ content: 'You are banned from making play requests!', ephemeral: true });
                }

                const game = interaction.options.getString('game');
                const playRequestId = `PR#${Math.floor(Math.random() * 10000).toString().padStart(6, '0')}`;

                if (!GAMES[game]) {
                    return interaction.reply({ content: 'Game not found!', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`Play Request: ${game}`)
                    .setDescription(`Play Request ID: ${playRequestId}\n\nAccepts: 0\nDenies: 0`)
                    .setImage(GAMES[game])
                    .setFooter({ text: 'React to accept, deny, or report the request.' });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept_${playRequestId}`)
                            .setLabel('Accept')
                            .setStyle('Success'),
                        new ButtonBuilder()
                            .setCustomId(`deny_${playRequestId}`)
                            .setLabel('Deny')
                            .setStyle('Danger'),
                        new ButtonBuilder()
                            .setCustomId(`report_${playRequestId}`)
                            .setLabel('Report')
                            .setStyle('Secondary')
                    );

                // Send the full play request embed to the notification channel
                const notificationChannel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
                const notificationMessage = await notificationChannel.send({ embeds: [embed], components: [row] });

                // Store the play request details
                playRequests.set(playRequestId, {
                    userId: interaction.user.id,
                    game,
                    messageId: notificationMessage.id,
                    status: 'pending',
                    acceptCount: 0,
                    denyCount: 0,
                    acceptedBy: new Set(),
                    deniedBy: new Set(),
                    notificationMessageId: notificationMessage.id
                });

                // Send a preview of the play request to the requester
                try {
                    await updateRequesterPreview(playRequestId, 'Pending');

                    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('New Play Request')
                        .addFields(
                            { name: 'Channel', value: interaction.channel.name },
                            { name: 'Requester', value: `<@${interaction.user.id}>` },
                            { name: 'Game', value: game },
                            { name: 'Play Request ID', value: playRequestId }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                } catch (error) {
                    console.error('Error sending DM to requester:', error);
                    await interaction.reply({ content: 'Failed to send a direct message. Please ensure you have DMs enabled from this server.', ephemeral: true });
                }
            } else if (commandName === 'playend') {
                const playRequestId = interaction.options.getString('id');

                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const playRequest = playRequests.get(playRequestId);
                playRequest.status = 'ended';
                playRequests.set(playRequestId, playRequest);

                try {
                    const notificationMessage = await (await client.channels.fetch(NOTIFICATION_CHANNEL_ID)).messages.fetch(playRequest.notificationMessageId);
                    await notificationMessage.delete();
                } catch (error) {
                    console.error('Error deleting notification message:', error);
                }

                await interaction.reply({ content: `Play request ${playRequestId} has been ended.`, ephemeral: true });
            } else if (commandName === 'ban') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason');
                const bannedUsers = readBannedUsers();

                if (bannedUsers.includes(user.id)) {
                    return interaction.reply({ content: 'User is already banned.', ephemeral: true });
                }

                bannedUsers.push(user.id);
                writeBannedUsers(bannedUsers);

                await interaction.reply({ content: `User ${user.tag} has been banned for: ${reason}`, ephemeral: true });
            } else if (commandName === 'unban') {
                const userId = interaction.options.getString('user');
                const bannedUsers = readBannedUsers();
                const index = bannedUsers.indexOf(userId);

                if (index === -1) {
                    return interaction.reply({ content: 'User is not banned.', ephemeral: true });
                }

                bannedUsers.splice(index, 1);
                writeBannedUsers(bannedUsers);

                await interaction.reply({ content: `User with ID ${userId} has been unbanned.`, ephemeral: true });
            } else if (commandName === 'report') {
                const playRequestId = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const playRequest = playRequests.get(playRequestId);

                const reportEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Play Request Report')
                    .addFields(
                        { name: 'Play Request ID', value: playRequestId },
                        { name: 'Reporter', value: `<@${interaction.user.id}>` },
                        { name: 'Reason', value: reason },
                        { name: 'Game', value: playRequest.game },
                        { name: 'Requester', value: `<@${playRequest.userId}>` }
                    )
                    .setTimestamp();

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                await reportChannel.send({ embeds: [reportEmbed] });

                await interaction.reply({ content: `Play request ${playRequestId} has been reported.`, ephemeral: true });
            }
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                return interaction.reply({ content: 'Play request not found!', ephemeral: true });
            }

            switch (action) {
                case 'accept':
                    if (!playRequest.acceptedBy.has(interaction.user.id)) {
                        playRequest.acceptedBy.add(interaction.user.id);
                        playRequest.acceptCount++;
                        playRequests.set(playRequestId, playRequest);

                        const embed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle(`Play Request Accepted`)
                            .setDescription(`Play request ID: ${playRequestId}\n\nAccepts: ${playRequest.acceptCount}\nDenies: ${playRequest.denyCount}`)
                            .setImage(GAMES[playRequest.game]);

                        const notificationMessage = await (await client.channels.fetch(NOTIFICATION_CHANNEL_ID)).messages.fetch(playRequest.notificationMessageId);
                        await notificationMessage.edit({ embeds: [embed] });

                        await interaction.reply({ content: 'Play request accepted.', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'You have already accepted this play request.', ephemeral: true });
                    }
                    break;
                case 'deny':
                    if (!playRequest.deniedBy.has(interaction.user.id)) {
                        playRequest.deniedBy.add(interaction.user.id);
                        playRequest.denyCount++;
                        playRequests.set(playRequestId, playRequest);

                        const embed = new EmbedBuilder()
                            .setColor('#ff0000')
                            .setTitle(`Play Request Denied`)
                            .setDescription(`Play request ID: ${playRequestId}\n\nAccepts: ${playRequest.acceptCount}\nDenies: ${playRequest.denyCount}`)
                            .setImage(GAMES[playRequest.game]);

                        const notificationMessage = await (await client.channels.fetch(NOTIFICATION_CHANNEL_ID)).messages.fetch(playRequest.notificationMessageId);
                        await notificationMessage.edit({ embeds: [embed] });

                        await interaction.reply({ content: 'Play request denied.', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'You have already denied this play request.', ephemeral: true });
                    }
                    break;
                case 'report':
                    await interaction.showModal(createReportModal(playRequestId));
                    break;
                default:
                    await interaction.reply({ content: 'Unknown action.', ephemeral: true });
                    break;
            }
        } else if (interaction.isModalSubmit()) {
            const { customId } = interaction;
            const playRequestId = customId.split('_')[1];
            const reason = interaction.fields.getTextInputValue('reason');

            if (!playRequests.has(playRequestId)) {
                return interaction.reply({ content: 'Play request not found!', ephemeral: true });
            }

            const playRequest = playRequests.get(playRequestId);

            const reportEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Play Request Report')
                .addFields(
                    { name: 'Play Request ID', value: playRequestId },
                    { name: 'Reporter', value: `<@${interaction.user.id}>` },
                    { name: 'Reason', value: reason },
                    { name: 'Game', value: playRequest.game },
                    { name: 'Requester', value: `<@${playRequest.userId}>` }
                )
                .setTimestamp();

            const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
            await reportChannel.send({ embeds: [reportEmbed] });

            await interaction.reply({ content: 'Play request has been reported.', ephemeral: true });
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
    }
});

client.login(TOKEN);

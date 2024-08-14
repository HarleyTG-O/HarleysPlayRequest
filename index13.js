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
            throw new Error('Play Request not found.');
        }

        const requester = await client.users.fetch(playRequest.userId);
        if (requester) {
            const requesterDm = await requester.createDM();
            const acceptUsers = playRequest.acceptedBy.size > 0 ? [...playRequest.acceptedBy].map(id => `<@${id}>`).join(', ') : 'None';
            const denyUsers = playRequest.deniedBy.size > 0 ? [...playRequest.deniedBy].map(id => `<@${id}>`).join(', ') : 'None';

            const previewEmbed = new EmbedBuilder()
                .setColor(status === 'Accepted' ? '#00ff00' : '#ff0000')
                .setTitle('Play Request Preview')
                .setDescription(`Your Play Request ID: ${playRequestId}\n\nStatus: ${status}`)
                .addFields(
                    { name: 'Game', value: playRequest.game },
                    ...(playRequest.acceptedBy.size > 0 ? [{ name: 'Accepted By', value: acceptUsers }] : []),
                    ...(playRequest.deniedBy.size > 0 ? [{ name: 'Denied By', value: denyUsers }] : [])
                )
                .setImage(GAMES[playRequest.game]);

            if (playRequest.message) {
                previewEmbed.addFields({ name: 'Message', value: playRequest.message });
            }

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
                const playRequestId = `PR#${Math.floor(Math.random() * 999999).toString().padStart(6, '0')}`;

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

                // Save the play requests to file
                writePlayRequests(playRequests);

                // Send a confirmation to the user
                await interaction.reply({ content: `Play request for **${game}** has been submitted!`, ephemeral: true });
            } else if (commandName === 'playend') {
                const playRequestId = interaction.options.getString('id');

                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Invalid play request ID!', ephemeral: true });
                }

                playRequests.delete(playRequestId);
                writePlayRequests(playRequests);

                await interaction.reply({ content: `Play request ID ${playRequestId} has been ended.`, ephemeral: true });
            } else if (commandName === 'ban') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason');

                if (user) {
                    const bannedUsers = readBannedUsers();
                    if (!bannedUsers.includes(user.id)) {
                        bannedUsers.push(user.id);
                        writeBannedUsers(bannedUsers);

                        await interaction.reply({ content: `User <@${user.id}> has been banned for: ${reason}`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: `User <@${user.id}> is already banned.`, ephemeral: true });
                    }
                }
            } else if (commandName === 'unban') {
                const userId = interaction.options.getString('user');
                const bannedUsers = readBannedUsers();

                if (bannedUsers.includes(userId)) {
                    const updatedBannedUsers = bannedUsers.filter(id => id !== userId);
                    writeBannedUsers(updatedBannedUsers);

                    await interaction.reply({ content: `User <@${userId}> has been unbanned.`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `User <@${userId}> is not banned.`, ephemeral: true });
                }
            } else if (commandName === 'report') {
                const playRequestId = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Invalid play request ID!', ephemeral: true });
                }

                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Play Request Report')
                    .addFields(
                        { name: 'Play Request ID', value: playRequestId },
                        { name: 'Reported By', value: interaction.user.tag },
                        { name: 'Reason', value: reason }
                    );

                await logChannel.send({ embeds: [embed] });
                await interaction.reply({ content: 'Play request has been reported.', ephemeral: true });
            }
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');

            if (action === 'accept') {
                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const playRequest = playRequests.get(playRequestId);
                if (playRequest.acceptedBy.has(interaction.user.id)) {
                    return interaction.reply({ content: 'You have already accepted this play request.', ephemeral: true });
                }

                playRequest.acceptedBy.add(interaction.user.id);
                playRequest.acceptCount = playRequest.acceptedBy.size;
                playRequests.set(playRequestId, playRequest);

                await interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#0099ff')
                            .setTitle(`Play Request: ${playRequest.game}`)
                            .setDescription(`Play Request ID: ${playRequestId}\n\nAccepts: ${playRequest.acceptCount}\nDenies: ${playRequest.denyCount}`)
                            .setImage(GAMES[playRequest.game])
                            .setFooter({ text: 'React to accept, deny, or report the request.' })
                    ]
                });

                await updateRequesterPreview(playRequestId, 'Accepted');
                writePlayRequests(playRequests);
            } else if (action === 'deny') {
                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const playRequest = playRequests.get(playRequestId);
                if (playRequest.deniedBy.has(interaction.user.id)) {
                    return interaction.reply({ content: 'You have already denied this play request.', ephemeral: true });
                }

                playRequest.deniedBy.add(interaction.user.id);
                playRequest.denyCount = playRequest.deniedBy.size;
                playRequests.set(playRequestId, playRequest);

                await interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ff0000')
                            .setTitle(`Play Request: ${playRequest.game}`)
                            .setDescription(`Play Request ID: ${playRequestId}\n\nAccepts: ${playRequest.acceptCount}\nDenies: ${playRequest.denyCount}`)
                            .setImage(GAMES[playRequest.game])
                            .setFooter({ text: 'React to accept, deny, or report the request.' })
                    ]
                });

                await updateRequesterPreview(playRequestId, 'Denied');
                writePlayRequests(playRequests);
            } else if (action === 'report') {
                if (!playRequests.has(playRequestId)) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const reportModal = createReportModal(playRequestId);
                await interaction.showModal(reportModal);
            }
        } else if (interaction.isModalSubmit()) {
            const playRequestId = interaction.customId.split('_')[1];
            const reason = interaction.fields.getTextInputValue('reason');

            if (!playRequests.has(playRequestId)) {
                return interaction.reply({ content: 'Play request not found!', ephemeral: true });
            }

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Play Request Report')
                .addFields(
                    { name: 'Play Request ID', value: playRequestId },
                    { name: 'Reported By', value: interaction.user.tag },
                    { name: 'Reason', value: reason }
                );

            await logChannel.send({ embeds: [embed] });
            await interaction.reply({ content: 'Play request has been reported.', ephemeral: true });
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
    }
});

client.login(TOKEN);

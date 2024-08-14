const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID, NOTIFICATION_CHANNEL_ID, REPORT_CHANNEL_ID, GAMES } = require('./config.json');
const fs = require('fs');
const path = './ban.json'; // Path to the ban file
const playRequestsPath = './playRequests.json'; // Path to the play requests file
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

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
        return new Map(JSON.parse(data).playRequests || []);
    } catch (error) {
        console.error('Error reading play requests:', error);
        return new Map();
    }
};

// Function to write play requests to playRequests.json
const writePlayRequests = () => {
    try {
        const playRequestsArray = Array.from(playRequests.entries()).map(([id, request]) => [id, request]);
        fs.writeFileSync(playRequestsPath, JSON.stringify({ playRequests: playRequestsArray }, null, 2));
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

    console.log(`Logged in as ${client.user.tag}!`);

    // Load existing play requests from file
    const loadedPlayRequests = readPlayRequests();
    loadedPlayRequests.forEach((request, id) => {
        playRequests.set(id, request);
    });
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
                    message: interaction.options.getString('message') || null
                });

                // Write the updated play requests to file
                writePlayRequests();

                await interaction.reply({ content: `Play request submitted! Request ID: ${playRequestId}`, ephemeral: true });

            } else if (commandName === 'playend') {
                const playRequestId = interaction.options.getString('id');
                const playRequest = playRequests.get(playRequestId);

                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found!', ephemeral: true });
                }

                playRequest.status = 'ended';
                playRequests.set(playRequestId, playRequest);

                // Write the updated play requests to file
                writePlayRequests();

                await interaction.reply({ content: `Play request ended! Request ID: ${playRequestId}`, ephemeral: true });
            } else if (commandName === 'ban') {
                const userToBan = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason');

                const bannedUsers = readBannedUsers();
                if (!bannedUsers.includes(userToBan.id)) {
                    bannedUsers.push(userToBan.id);
                    writeBannedUsers(bannedUsers);

                    await interaction.reply({ content: `User ${userToBan.tag} has been banned. Reason: ${reason}`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `User ${userToBan.tag} is already banned.`, ephemeral: true });
                }
            } else if (commandName === 'unban') {
                const userIdToUnban = interaction.options.getString('user');
                const bannedUsers = readBannedUsers();

                const index = bannedUsers.indexOf(userIdToUnban);
                if (index > -1) {
                    bannedUsers.splice(index, 1);
                    writeBannedUsers(bannedUsers);

                    await interaction.reply({ content: `User with ID ${userIdToUnban} has been unbanned.`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `User with ID ${userIdToUnban} is not banned.`, ephemeral: true });
                }
            } else if (commandName === 'report') {
                const playRequestId = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found!', ephemeral: true });
                }

                const reportEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Play Request Report')
                    .setDescription(`Play Request ID: ${playRequestId}\n\nReported by: ${interaction.user.tag}\nReason: ${reason}`)
                    .addFields(
                        { name: 'Game', value: playRequest.game },
                        ...(playRequest.message ? [{ name: 'Message', value: playRequest.message }] : [])
                    )
                    .setFooter({ text: 'Report logged' });

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                await reportChannel.send({ embeds: [reportEmbed] });

                await interaction.reply({ content: `Play request reported!`, ephemeral: true });
            }
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                return interaction.reply({ content: 'Play Request not found!', ephemeral: true });
            }

            if (action === 'accept') {
                if (!playRequest.acceptedBy.has(interaction.user.id)) {
                    playRequest.acceptedBy.add(interaction.user.id);
                    playRequest.acceptCount++;
                }

                if (playRequest.deniedBy.has(interaction.user.id)) {
                    playRequest.deniedBy.delete(interaction.user.id);
                    playRequest.denyCount--;
                }

                await interaction.update({ components: [createActionRow(playRequestId)] });

                updateRequesterPreview(playRequestId, 'Accepted');
            } else if (action === 'deny') {
                if (!playRequest.deniedBy.has(interaction.user.id)) {
                    playRequest.deniedBy.add(interaction.user.id);
                    playRequest.denyCount++;
                }

                if (playRequest.acceptedBy.has(interaction.user.id)) {
                    playRequest.acceptedBy.delete(interaction.user.id);
                    playRequest.acceptCount--;
                }

                await interaction.update({ components: [createActionRow(playRequestId)] });

                updateRequesterPreview(playRequestId, 'Denied');
            } else if (action === 'report') {
                await interaction.showModal(createReportModal(playRequestId));
            }

            // Write the updated play requests to file
            writePlayRequests();

        } else if (interaction.isModalSubmit()) {
            const [action, playRequestId] = interaction.customId.split('_');
            if (action === 'report') {
                const reason = interaction.fields.getTextInputValue('reason');

                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play Request not found!', ephemeral: true });
                }

                const reportEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Play Request Report')
                    .setDescription(`Play Request ID: ${playRequestId}\n\nReported by: ${interaction.user.tag}\nReason: ${reason}`)
                    .addFields(
                        { name: 'Game', value: playRequest.game },
                        ...(playRequest.message ? [{ name: 'Message', value: playRequest.message }] : [])
                    )
                    .setFooter({ text: 'Report logged' });

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                await reportChannel.send({ embeds: [reportEmbed] });

                await interaction.reply({ content: `Play request reported!`, ephemeral: true });
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
        } else {
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
    }
});

client.login(TOKEN);

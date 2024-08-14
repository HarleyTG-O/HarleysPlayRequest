const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
                    ...(playRequest.acceptedBy.size > 0 ? [{ name: 'Accepts', value: acceptUsers }] : []),
                    ...(playRequest.deniedBy.size > 0 ? [{ name: 'Denies', value: denyUsers }] : [])
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

                // Send a preview of the play request to the requester
                try {
                    await updateRequesterPreview(playRequestId, 'Pending');

                    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('Play Request Created')
                        .setDescription(`Play Request ID: ${playRequestId}\n\nGame: ${game}\nRequester: <@${interaction.user.id}>`)
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [logEmbed] });
                } catch (error) {
                    console.error('Error sending play request preview:', error);
                }

                await interaction.reply({ content: `Your request for ${game} has been sent!`, ephemeral: true });
            }

            // Other command handlers
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                throw new Error('Play request not found.');
            }

            switch (action) {
                case 'accept':
                    if (playRequest.acceptedBy.has(interaction.user.id)) {
                        throw new Error('You have already accepted this request.');
                    }

                    playRequest.acceptedBy.add(interaction.user.id);
                    playRequest.acceptCount++;

                    const acceptEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('Play Request Accepted')
                        .setDescription(`<@${interaction.user.id}> has accepted the play request.`)
                        .addFields(
                            { name: 'Play Request ID', value: playRequestId },
                            { name: 'Game', value: playRequest.game },
                            { name: 'Accepted By', value: [...playRequest.acceptedBy].map(id => `<@${id}>`).join(', ') }
                        );

                    await updateRequesterPreview(playRequestId, 'Accepted');
                    await interaction.update({ embeds: [acceptEmbed] });
                    break;

                case 'deny':
                    if (playRequest.deniedBy.has(interaction.user.id)) {
                        throw new Error('You have already denied this request.');
                    }

                    playRequest.deniedBy.add(interaction.user.id);
                    playRequest.denyCount++;

                    const denyEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('Play Request Denied')
                        .setDescription(`<@${interaction.user.id}> has denied the play request.`)
                        .addFields(
                            { name: 'Play Request ID', value: playRequestId },
                            { name: 'Game', value: playRequest.game },
                            { name: 'Denied By', value: [...playRequest.deniedBy].map(id => `<@${id}>`).join(', ') }
                        );

                    await updateRequesterPreview(playRequestId, 'Denied');
                    await interaction.update({ embeds: [denyEmbed] });
                    break;

                case 'report':
                    await interaction.showModal(createReportModal(playRequestId));
                    break;

                default:
                    throw new Error('Unknown button action.');
            }
        } else if (interaction.isModalSubmit()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const reason = interaction.fields.getTextInputValue('reason');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                throw new Error('Play Request not found.');
            }

            switch (action) {
                case 'report':
                    const reportEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('Play Request Reported')
                        .setDescription(`A Play Request has been reported by <@${interaction.user.id}>.\n\n**Reason:** ${reason}`)
                        .addFields(
                            { name: 'Play Request ID', value: playRequestId },
                            { name: 'Game', value: playRequest.game }
                        )
                        .setTimestamp();

                    const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                    await reportChannel.send({ embeds: [reportEmbed] });

                    await interaction.reply({ content: 'Your report has been submitted.', ephemeral: true });
                    break;

                default:
                    throw new Error('Unknown modal submit action.');
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        await interaction.reply({ content: `Error: ${error.message}`, ephemeral: true });
    }
});

client.login(TOKEN);

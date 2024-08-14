const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Destructure the configuration fields
const { TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID, NOTIFICATION_CHANNEL_ID, REPORT_CHANNEL_ID, REQUEST_MENU_CHANNEL_ID, GAMES } = config;

// Paths for JSON files
const paths = {
    ban: path.join(__dirname, 'ban.json'),
    requestMenu: path.join(__dirname, 'requestMenu.json')
};

const playRequests = new Map();

// Function to read banned users from ban.json
const readBannedUsers = () => {
    try {
        const data = fs.readFileSync(paths.ban, 'utf8');
        return JSON.parse(data).bannedUsers || [];
    } catch (error) {
        console.error('Error reading banned users:', error);
        return [];
    }
};

// Function to write banned users to ban.json
const writeBannedUsers = (bannedUsers) => {
    try {
        fs.writeFileSync(paths.ban, JSON.stringify({ bannedUsers }, null, 2));
    } catch (error) {
        console.error('Error writing banned users:', error);
    }
};

// Load request menu configuration
const loadRequestMenuConfig = () => {
    try {
        const data = fs.readFileSync(paths.requestMenu, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading request menu configuration:', error);
        return { title: 'Play Request Menu', games: [] };
    }
};

// Save request menu configuration
const saveRequestMenuConfig = (config) => {
    try {
        fs.writeFileSync(paths.requestMenu, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving request menu configuration:', error);
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
        },
        {
            name: 'requestmenu',
            description: 'Show the play request menu'
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

const updatePlayRequestEmbed = (embed, playRequest) => {
    const acceptedUsersList = Array.from(playRequest.acceptedBy).map(id => `<@${id}>`).join(', ') || 'None';
    const deniedUsersList = Array.from(playRequest.deniedBy).map(id => `<@${id}>`).join(', ') || 'None';

    return new EmbedBuilder(embed.data)
        .setDescription(`Play request ID: ${playRequest.id}\n\nStatus: ${playRequest.status}\nAccepts: ${playRequest.acceptCount}\nDenies: ${playRequest.denyCount}\n\nAccepted Users: ${acceptedUsersList}\nDenied Users: ${deniedUsersList}`)
        .setColor(playRequest.status === 'accepted' ? '#00ff00' : playRequest.status === 'denied' ? '#ff0000' : '#0099ff');
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
                const playRequestId = `playrequest#${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

                if (!GAMES[game]) {
                    return interaction.reply({ content: 'Game not found!', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`Play Request: ${game}`)
                    .setDescription(`Play request ID: ${playRequestId}\n\nStatus: Pending\nAccepts: 0\nDenies: 0`)
                    .setImage(GAMES[game])
                    .setFooter({ text: 'React to accept, deny, or report the request.' });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept_${playRequestId}`)
                            .setLabel('Accept')
                            .setStyle('SUCCESS'),
                        new ButtonBuilder()
                            .setCustomId(`deny_${playRequestId}`)
                            .setLabel('Deny')
                            .setStyle('DANGER'),
                        new ButtonBuilder()
                            .setCustomId(`report_${playRequestId}`)
                            .setLabel('Report')
                            .setStyle('SECONDARY')
                    );

                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                if (logChannel.isTextBased()) {
                    const message = await logChannel.send({ embeds: [embed], components: [row] });
                    playRequests.set(playRequestId, { id: playRequestId, status: 'pending', acceptCount: 0, denyCount: 0, acceptedBy: new Set(), deniedBy: new Set(), messageId: message.id });
                    return interaction.reply({ content: 'Your play request has been sent!', ephemeral: true });
                }
            } else if (commandName === 'playend') {
                const playRequestId = interaction.options.getString('id');
                const playRequest = playRequests.get(playRequestId);

                if (!playRequest) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                if (playRequest.status !== 'pending') {
                    return interaction.reply({ content: 'This play request has already been processed.', ephemeral: true });
                }

                playRequest.status = 'ended';
                playRequests.set(playRequestId, playRequest);

                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                if (logChannel.isTextBased()) {
                    const message = await logChannel.messages.fetch(playRequest.messageId);
                    if (message) {
                        await message.edit({ embeds: [updatePlayRequestEmbed(message.embeds[0], playRequest)], components: [] });
                    }
                }

                return interaction.reply({ content: 'Play request has been ended.', ephemeral: true });
            } else if (commandName === 'ban') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason');

                let bannedUsers = readBannedUsers();
                if (!bannedUsers.includes(user.id)) {
                    bannedUsers.push(user.id);
                    writeBannedUsers(bannedUsers);
                    return interaction.reply({ content: `${user.tag} has been banned from making play requests. Reason: ${reason}`, ephemeral: true });
                }

                return interaction.reply({ content: `${user.tag} is already banned.`, ephemeral: true });
            } else if (commandName === 'unban') {
                const userId = interaction.options.getString('user');
                let bannedUsers = readBannedUsers();
                bannedUsers = bannedUsers.filter(id => id !== userId);
                writeBannedUsers(bannedUsers);
                return interaction.reply({ content: `User with ID ${userId} has been unbanned.`, ephemeral: true });
            } else if (commandName === 'report') {
                const playRequestId = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                const playRequest = playRequests.get(playRequestId);
                if (!playRequest) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                if (reportChannel.isTextBased()) {
                    await reportChannel.send(`Play request ID: ${playRequestId}\nReason: ${reason}\n\nReported by: ${interaction.user.tag}`);
                    return interaction.reply({ content: 'Play request has been reported.', ephemeral: true });
                }
            }
        } else if (interaction.isButton()) {
            const [action, playRequestId] = interaction.customId.split('_');
            const playRequest = playRequests.get(playRequestId);

            if (!playRequest) {
                return interaction.reply({ content: 'Play request not found!', ephemeral: true });
            }

            if (action === 'accept') {
                if (playRequest.acceptedBy.has(interaction.user.id)) {
                    return interaction.reply({ content: 'You have already accepted this request.', ephemeral: true });
                }
                playRequest.acceptCount++;
                playRequest.acceptedBy.add(interaction.user.id);
            } else if (action === 'deny') {
                if (playRequest.deniedBy.has(interaction.user.id)) {
                    return interaction.reply({ content: 'You have already denied this request.', ephemeral: true });
                }
                playRequest.denyCount++;
                playRequest.deniedBy.add(interaction.user.id);
            } else if (action === 'report') {
                const modal = createReportModal(playRequestId);
                await interaction.showModal(modal);
                return;
            }

            playRequests.set(playRequestId, playRequest);

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (logChannel.isTextBased()) {
                const message = await logChannel.messages.fetch(playRequest.messageId);
                if (message) {
                    await message.edit({ embeds: [updatePlayRequestEmbed(message.embeds[0], playRequest)] });
                }
            }

            return interaction.reply({ content: `Your action has been recorded.`, ephemeral: true });
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('report_')) {
                const playRequestId = interaction.customId.split('_')[1];
                const playRequest = playRequests.get(playRequestId);

                if (!playRequest) {
                    return interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }

                const reason = interaction.fields.getTextInputValue('reason');
                const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
                if (reportChannel.isTextBased()) {
                    await reportChannel.send(`Play request ID: ${playRequestId}\nReason: ${reason}\n\nReported by: ${interaction.user.tag}`);
                }

                return interaction.reply({ content: 'Play request has been reported.', ephemeral: true });
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: 'An error occurred while handling your request.', ephemeral: true });
        } else {
            await interaction.reply({ content: 'An error occurred while handling your request.', ephemeral: true });
        }
    }
});

client.login(TOKEN);

const { Client, GatewayIntentBits, MessageActionRow, MessageButton, EmbedBuilder, REST, Routes, InteractionType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Load stored play requests and banned users
let playRequests = {};
let bannedUsers = [];

const playRequestsFile = path.join(__dirname, 'playRequests.json');
const banFile = path.join(__dirname, 'ban.json');

if (fs.existsSync(playRequestsFile)) {
    playRequests = JSON.parse(fs.readFileSync(playRequestsFile, 'utf8'));
}

if (fs.existsSync(banFile)) {
    bannedUsers = JSON.parse(fs.readFileSync(banFile, 'utf8'));
}

// Create dynamic game options from the GAMES object in config.json
const gameOptions = Object.keys(config.GAMES).map(gameId => ({
    name: config.GAMES[gameId].name,
    value: gameId,
}));

// Define your commands (with dynamic game options)
const commands = [
    {
        name: 'play',
        description: 'Start a play request',
        options: [
            {
                name: 'game',
                type: 3, // STRING
                description: 'The game you want to play',
                required: true,
                choices: gameOptions, // Use dynamic game options
            },
            {
                name: 'message',
                type: 3, // STRING
                description: 'Additional message',
                required: false,
            },
        ],
    },
    {
        name: 'playend',
        description: 'End a play request',
        options: [
            {
                name: 'id',
                type: 3, // STRING
                description: 'ID of the play request to end',
                required: true,
            },
        ],
    },
    {
        name: 'ban',
        description: 'Ban a user from the play request service',
        options: [
            {
                name: 'user',
                type: 6, // USER
                description: 'The user to ban',
                required: true,
            },
        ],
    },
    {
        name: 'unban',
        description: 'Unban a user from the play request service',
        options: [
            {
                name: 'user',
                type: 6, // USER
                description: 'The user to unban',
                required: true,
            },
        ],
    },
];

// Register slash commands with Discord's API
const rest = new REST({ version: '10' }).setToken(config.TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

// Bot ready event
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Function to create an embed based on the template
const createEmbed = (templateName, placeholders) => {
    const template = config.menuTemplates[templateName];
    
    if (!template) {
        console.error('Template not found:', templateName);
        return;
    }
    
    const embed = new EmbedBuilder()
        .setTitle(template.embed.title)
        .setDescription(template.embed.description)
        .addFields(template.embed.fields.map(field => ({
            name: field.name,
            value: placeholders[field.value] || field.value,
            inline: field.inline,
        })))
        .setFooter({ text: template.embed.footer });
    
    return embed;
};

// Function to create action row buttons based on the template
const createActionRow = (templateName, playRequestId, requester) => {
    try {
        const template = config.menuTemplates[templateName];

        if (!template || !template.actionRow) {
            console.error('Action row template not found:', templateName);
            return;
        }

        const actionRow = new MessageActionRow()
            .addComponents(
                template.actionRow.buttons.map(button =>
                    new MessageButton()
                        .setCustomId(button.customId
                            .replace('{playRequestId}', playRequestId)
                            .replace('{requester}', requester)
                        )
                        .setLabel(button.label)
                        .setStyle(button.style)
                )
            );

        return actionRow;
    } catch (error) {
        console.error('Error creating action row:', error);
    }
};

// Command handling
client.on('interactionCreate', async interaction => {
    if (interaction.type === InteractionType.ApplicationCommand) {
        const { commandName, options } = interaction;

        if (commandName === 'play') {
            const game = options.getString('game');
            const message = options.getString('message');
            const requester = interaction.user.username;
            const playRequestId = Date.now().toString();

            // Check if the user is banned
            if (bannedUsers.includes(interaction.user.id)) {
                return interaction.reply({ content: 'You are banned from using this service.', ephemeral: true });
            }

            const placeholders = {
                '{playRequestId}': playRequestId,
                '{game}': game,
                '{requester}': requester,
                '{message}': message
            };

            const embed = createEmbed('main', placeholders);
            const actionRow = createActionRow('main', playRequestId, requester);

            if (!embed || !actionRow) {
                return interaction.reply({ content: 'Failed to create message components.', ephemeral: true });
            }

            // Send to the main request channel
            const channel = await client.channels.fetch(config.MAIN_REQUEST_CHANNEL_ID);
            await channel.send({ embeds: [embed], components: [actionRow] });

            // Send a DM to the requester
            await interaction.user.send({ embeds: [createEmbed('dm', placeholders)] });

            // Save play request
            playRequests[playRequestId] = { game, requester, message };

            fs.writeFileSync(playRequestsFile, JSON.stringify(playRequests, null, 2));
            await interaction.reply({ content: 'Play request created!', ephemeral: true });
        }

        if (commandName === 'playend') {
            const playRequestId = options.getString('id');

            if (playRequests[playRequestId]) {
                delete playRequests[playRequestId];
                fs.writeFileSync(playRequestsFile, JSON.stringify(playRequests, null, 2));
                await interaction.reply({ content: 'Play request ended!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Play request not found.', ephemeral: true });
            }
        }

        if (commandName === 'ban') {
            const user = options.getUser('user');

            if (!bannedUsers.includes(user.id)) {
                bannedUsers.push(user.id);
                fs.writeFileSync(banFile, JSON.stringify(bannedUsers, null, 2));
                await interaction.reply({ content: `${user.tag} has been banned.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `${user.tag} is already banned.`, ephemeral: true });
            }
        }

        if (commandName === 'unban') {
            const user = options.getUser('user');

            if (bannedUsers.includes(user.id)) {
                bannedUsers = bannedUsers.filter(id => id !== user.id);
                fs.writeFileSync(banFile, JSON.stringify(bannedUsers, null, 2));
                await interaction.reply({ content: `${user.tag} has been unbanned.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `${user.tag} is not banned.`, ephemeral: true });
            }
        }
    }
});

client.login(config.TOKEN);

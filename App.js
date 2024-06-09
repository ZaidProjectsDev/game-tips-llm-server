import 'dotenv/config';
import cors from 'cors';
import express, { json } from "express";
import {ChatOpenAI} from "@langchain/openai";
import {PromptTemplate} from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import fetch from "node-fetch";
import {AIMessage, HumanMessage} from "@langchain/core/messages";
import {
    ChatPromptTemplate,
    MessagesPlaceholder,
} from "@langchain/core/prompts";
import {BufferMemory} from "langchain/memory";
import {ConversationChain} from "langchain/chains";
//Define Express App variable
const app = express();
app.use(cors());
app.use(json());

const port =process.env.PORT || 3050; //Used 3050 cause the React client kept using port 3000
const chatMessageHistory = new ChatMessageHistory();
const chatPrompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a game tips provider. When a human asks for help with a game, provide tips relevant to the game. If you do not know much about the game, provide approximate tips. If you get Game Context information data, provide details such as the game's platform, release year and rating."],
    // The variable name here is what must align with memory
    new MessagesPlaceholder("chat_history"),
    ["human", "{question}"],
]);
let chatPromptMemory = new BufferMemory({
    memoryKey: "chat_history",
    returnMessages: true,
});

let currentGame = ""
//The data searching model that is supposed to deal with getting the NAME of the game has minimal temperature and token count so it doesn't add any extra info.
const model = new ChatOpenAI({
    maxTokens: 64,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiVersion: process.env.OPENAI_API_VERSION,
    azureOpenAIApiInstanceName: process.env.INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.ENGINE_NAME,
    temperature:0.1,
})
//Tips searching model needs to be creative with its output so it has a temparature of 0.65.
const tipsModel = new ChatOpenAI({
    maxTokens: -1,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiVersion: process.env.OPENAI_API_VERSION,
    azureOpenAIApiInstanceName: process.env.INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.ENGINE_NAME,
    temperature:0.65,})

const chatConversationChain = new ConversationChain({
    llm: tipsModel,
    prompt: chatPrompt,
    verbose: true,
    memory: chatPromptMemory,
});
async function appendChatHistory(human,message)
{
    if(human)
    {
       await chatMessageHistory.addMessage(new HumanMessage(message));
    }
    else
    {
       await chatMessageHistory.addMessage(new AIMessage(message))
    }
    console.log(`Updated Chat History Human : ${human} | Message : ${message}`);
}
async function getChatMessageHistory()
{
    const messages = await chatMessageHistory.getMessages();
    return messages;
}
async function resetChatHistory()
{
    chatPromptMemory = new BufferMemory({
        memoryKey: "chat_history",
        returnMessages: true,
    });
    chatConversationChain.memory  = chatPromptMemory;
    await  chatMessageHistory.clear();
    currentGame = ""
    console.log("The chat history was reset")
}

async function runQuestion(userQuestion)
{
    // await logHistory(true, userQuestion)
    let response = await getGameName(userQuestion);

    let gameDetailsResponse = await getGameDetails(response.content)
    // console.log(gameDetailsResponse)
    let gameTipsResponse = await getTipsForGame(userQuestion,gameDetailsResponse)
    //  await logHistory(false, gameTipsResponse.content)
    return gameTipsResponse;
}
//Get the game name so more information can be gathered via third party API
async function getGameName(userQuestion)
{

    const prompt = PromptTemplate.fromTemplate(`You will return the game_name from the user's question If there is no game, return no-game to game_name.: {question}
    game_name:`);
    const runnable = prompt.pipe(model);
    const  answer =await runnable.invoke({ question: `${userQuestion}` });
    console.log(`${answer}`);
    return answer;
}
//The actual tips retrieval.
async function getTipsForGame(userQuestion,context)
{
    const combined = `User Question : ${userQuestion} 
    Game Context : ${context}`;
    const answer  = await chatConversationChain.invoke({question: combined})
    return answer;
}


//Third party API used to get more information on the game being talked about.
//Information such as the platforms and release date.
async function getGameDetails(gameName) {
    // Check cache first

    if (gameName.includes('no-game')) {
        return currentGame;
        return null;
    }
    else
    {
        currentGame = gameName;
    }
    const apiKey = process.env.RAWG_API_KEY;
    const url = `https://api.rawg.io/api/games?search=${encodeURIComponent(gameName)}&key=${apiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error: ${response.statusText}`);
        }
        const data = await response.json();
        const details = data.results.length > 0 ? data.results[0] : null; // Return first result or null if no matches

        return details;
    } catch (error) {
        console.error('Failed to fetch game details:', error);
        throw error;
    }
}

//Get the question and respond to the user.
app.get('/gamequestion', async (req, res) => {
    const question = req.query.question;

    if (!question) {
        return res.status(400).send({ error: 'Please provide a question' });
    }
    await appendChatHistory(true,question);
    const detailedAnswer = await runQuestion(question)
    await appendChatHistory(false,detailedAnswer);
    try
    {
        res.json({ answer: detailedAnswer});

    }
    catch (error)
    {
        console.error("Error during processing:", error);
        res.status(500).send("An error occurred while processing your request.");
    }
});
app.get('/resetconversation', async (req,res) =>{
    await resetChatHistory();
    res.send('The Chat was reset.')
})

app.get('/gethistory', async(req,res)=>{
    const history = await getChatMessageHistory();
    res.json({history:history})
})
app.get('/', (req, res) => {
    res.send('Hi, all systems go!');
});

app.listen(port, () => {
    console.log(`Server listening at ${port}`);
});

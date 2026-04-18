"""Action registry — central hub for all tools/actions Jarvis can perform."""

import asyncio
from typing import Callable, Any
from loguru import logger


class ActionRegistry:
    """Singleton registry for all available actions/tools.

    Actions are registered with a name, description, parameters schema,
    and an async handler function. The AI engine calls tools by name,
    and the registry dispatches to the correct handler.
    """

    _instance = None

    def __init__(self):
        self.actions: dict[str, dict] = {}

    @classmethod
    def get_instance(cls) -> "ActionRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(
        self,
        name: str,
        description: str,
        handler: Callable[..., Any],
        parameters: dict | None = None,
    ):
        """Register an action.

        Args:
            name: Unique action name (used in tool calls).
            description: What this action does (shown to AI).
            handler: Async function to execute.
            parameters: JSON Schema for the action's parameters.
        """
        self.actions[name] = {
            "name": name,
            "description": description,
            "handler": handler,
            "parameters": parameters or {
                "type": "object",
                "properties": {},
            },
        }
        logger.debug(f"Registered action: {name}")

    async def execute(self, name: str, arguments: dict = None) -> str:
        """Execute a registered action by name.

        Args:
            name: The action name.
            arguments: Dictionary of arguments.

        Returns:
            String result of the action.
        """
        if name not in self.actions:
            error = f"Unknown action: {name}"
            logger.warning(error)
            return error

        action = self.actions[name]
        handler = action["handler"]
        arguments = arguments or {}

        try:
            logger.info(f"Executing action: {name}({arguments})")
            result = await handler(**arguments) if asyncio.iscoroutinefunction(handler) else handler(**arguments)
            result_str = str(result) if result is not None else "Done."
            logger.info(f"Action {name} completed: {result_str[:100]}")
            return result_str
        except Exception as e:
            error = f"Action {name} failed: {e}"
            logger.error(error)
            return error

    def list_actions(self) -> list[str]:
        """List all registered action names."""
        return list(self.actions.keys())


def get_tools_for_ai(engine_name: str) -> list[dict]:
    """Get tool definitions formatted for a specific AI engine."""
    registry = ActionRegistry.get_instance()
    tools = []
    for action in registry.actions.values():
        tools.append({
            "name": action["name"],
            "description": action["description"],
            "parameters": action["parameters"],
        })
    return tools

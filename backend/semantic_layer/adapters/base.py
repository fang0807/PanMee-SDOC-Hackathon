from abc import ABC, abstractmethod
from typing import Any, Dict


class SemanticAdapter(ABC):
    """
    Contract between a host-system version and the reusable Semantic Layer.

    Host versions may use different field names, email shapes, or
    classification result structures. The adapter converts them into one
    stable schema before they reach the Semantic Core.
    """

    @abstractmethod
    def email_to_standard(self, email: Any) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def classification_to_standard(self, result: Any) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fields_to_standard(self, fields: Any) -> Dict[str, Any]:
        raise NotImplementedError

    def fields_from_standard(
        self,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Convert canonical field names back to the host system.

        Default behaviour is identity mapping. Override when a host version
        expects different output names.
        """
        return dict(fields or {})
